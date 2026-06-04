import type { DocumentResult } from './pipeline';

/**
 * External-source enrichment (plan §8, the MCP *client* role). After extraction,
 * Decant can act as an MCP client against other MCP servers to:
 *   - ENRICH:  add derived values (e.g. an FX-converted base-currency amount);
 *   - VERIFY:  cross-check an extracted value against an authoritative source
 *              (e.g. a company registry) — a mismatch is a safe-failure signal
 *              that flows into the SAME trust loop (route the field to review).
 *
 * This module is PURE (no MCP SDK): types + the name comparison + how an
 * enrichment outcome maps back onto a document's fields. The actual MCP calls
 * live in @decant/enrich (a thin adapter), keeping the core transport-agnostic.
 */

export interface FxEnrichment {
  kind: 'fx';
  /** The field whose value was converted (e.g. 'total'). */
  field: string;
  amount: number;
  currency: string;
  base: string;
  baseAmount: number;
  rate: number;
  /** ISO date the rate is quoted for. */
  asOf: string;
}

export type VerificationStatus =
  | 'verified' // found, value matches, AND the record is in good standing
  | 'mismatch' // found but the values disagree (an authority contradicts us)
  | 'not_found' // the key is not on file with the authority (could not confirm)
  | 'inactive' // found and value matches but the record is not in good standing (e.g. dissolved)
  | 'unavailable'; // the authority could not be reached/queried (attempted, not skipped)

/**
 * The outcome of cross-checking one extracted field against an external authority.
 * Source-agnostic: the SAME shape describes a company-registry check, a tax-ID
 * check, a bank-account-name check, … (see `makeVerifier` in @decant/enrich — a
 * consumer adds a source by implementing one lookup function).
 */
export interface VerificationEnrichment {
  kind: 'verification';
  /** Which verifier produced this (drives the signal/audit key), e.g. 'registry', 'cac', 'taxId'. */
  verifier: string;
  /** The document field this verdict applies to and routes on failure (e.g. 'companyName'). */
  field: string;
  /** The value we extracted for `field`. */
  extractedValue: string | null;
  /** The authoritative value from the source; null when not found. */
  authoritativeValue: string | null;
  /** 0..1 similarity between extracted and authoritative values. */
  matchScore: number;
  status: VerificationStatus;
  /** The record's standing as reported by the source (e.g. ACTIVE/INACTIVE), if any. */
  standing?: string | null;
  /** Which source answered (e.g. 'gleif', 'cac', 'demo') — for the audit trail. */
  source?: string;
  /** An anchoring reference for the matched record (e.g. a GLEIF LEI, a registry URL/id). */
  reference?: string | null;
}

/** What a consumer's lookup returns: the authoritative record (or null ⇒ not found). */
export interface AuthorityRecord {
  /** The canonical value to compare against the extracted field (e.g. the registered name). */
  value: string | null;
  /** Optional standing/status; an explicit non-active value yields `inactive`. */
  standing?: string | null;
  /** Optional anchoring reference for the audit trail. */
  reference?: string | null;
  /** Optional source label (e.g. 'cac', 'gleif'). */
  source?: string;
}

export type Enrichment = FxEnrichment | VerificationEnrichment;

/** A value match at or above this score is treated as verified. */
export const VERIFICATION_MATCH_THRESHOLD = 0.8;

const CORP_SUFFIXES = new Set(['ltd', 'limited', 'plc', 'inc', 'incorporated', 'llc', 'llp', 'co', 'company']);

/** Lowercase, strip punctuation, drop corporate suffixes, collapse whitespace. */
export function normalizeCompanyName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !CORP_SUFFIXES.has(t))
    .join(' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/**
 * Similarity (0..1) between two company names: the max of token-set Jaccard and
 * a character Levenshtein ratio over the normalized forms. Robust to suffix
 * differences ("Acme Nigeria Limited" ≈ "Acme Nigeria Ltd" → 1.0) and minor
 * token additions.
 */
export function compareNames(a: string, b: string): number {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  const jaccard = union === 0 ? 0 : inter / union;

  const dist = levenshtein(na, nb);
  const lenRatio = 1 - dist / Math.max(na.length, nb.length);

  return Math.max(jaccard, lenRatio);
}

/** An explicit non-active standing means NOT in good standing; null/unknown is given the benefit of the doubt. */
function isGoodStanding(standing: string | null | undefined): boolean {
  if (standing == null || standing.trim() === '') return true;
  return standing.trim().toUpperCase() === 'ACTIVE';
}

/**
 * Decide a verification verdict from an authoritative record + the extracted value
 * (pure). `record == null` ⇒ not_found. A value match only "verifies" if the
 * record is also in good standing; a matched-but-not-active record is `inactive`.
 * `compare` defaults to the name comparator but a consumer can pass an exact/custom
 * one (e.g. for IDs). For an unreachable source, use `unavailableVerification`.
 */
export function buildVerification(params: {
  verifier: string;
  field: string;
  extractedValue: string | null;
  record: AuthorityRecord | null;
  threshold?: number;
  compare?: (a: string, b: string) => number;
}): VerificationEnrichment {
  const { verifier, field, extractedValue, record, threshold = VERIFICATION_MATCH_THRESHOLD, compare = compareNames } = params;
  const base = {
    kind: 'verification' as const,
    verifier,
    field,
    extractedValue,
    standing: record?.standing ?? null,
    source: record?.source,
    reference: record?.reference ?? null,
  };
  if (!record || record.value == null) {
    return { ...base, authoritativeValue: null, matchScore: 0, status: 'not_found' };
  }
  const score = extractedValue ? compare(extractedValue, record.value) : 0;
  const status: VerificationStatus =
    score < threshold ? 'mismatch' : isGoodStanding(record.standing) ? 'verified' : 'inactive';
  return { ...base, authoritativeValue: record.value, matchScore: score, status };
}

/** A verification verdict for a source that could not be reached/queried (attempted, not skipped). */
export function unavailableVerification(verifier: string, field: string, extractedValue: string | null, source?: string): VerificationEnrichment {
  return { kind: 'verification', verifier, field, extractedValue, authoritativeValue: null, matchScore: 0, status: 'unavailable', source, standing: null, reference: null };
}

/**
 * Fold enrichment outcomes back onto a document's fields (pure). Each verification
 * verdict routes its `field` with a DISTINCT, verifier-scoped signal so a reviewer
 * can tell apart "an authority contradicts us" (mismatch), "not on file"
 * (not_found), "found but not in good standing" (inactive), and "couldn't reach
 * the source" (unavailable) — all route to review (external-source safe failure),
 * while a verified match records a positive `<verifier>Verified` corroboration
 * signal without changing status. Confidence is left untouched (the model's own
 * certainty stays honest; the routing reason is external). Signal keys are
 * `<verifier>Verified|Mismatch|NotFound|Inactive|Unavailable`.
 */
export function applyEnrichment(doc: DocumentResult, enrichments: Enrichment[]): DocumentResult {
  const verifications = enrichments.filter((e): e is VerificationEnrichment => e.kind === 'verification');
  const review = 'needs_review' as const;
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

  const fields = doc.fields.map((f0) => {
    let f = f0;
    for (const v of verifications) {
      if (v.field !== f.fieldPath) continue;
      if (v.status === 'verified') {
        f = { ...f, signals: { ...f.signals, [`${v.verifier}Verified`]: true } };
      } else {
        // mismatch | not_found | inactive | unavailable → route to review with a scoped signal
        f = { ...f, status: review, signals: { ...f.signals, [`${v.verifier}${cap(v.status === 'not_found' ? 'notFound' : v.status)}`]: true } };
      }
    }
    return f;
  });

  return { ...doc, fields, enrichments };
}
