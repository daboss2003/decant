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

export type RegistryStatus =
  | 'verified' // RC found and the registered name matches the extracted one
  | 'mismatch' // RC found but the names disagree (an authority contradicts us)
  | 'not_found' // RC not in the registry (could not confirm)
  | 'unavailable'; // the registry could not be reached/queried (attempted, not skipped)

export interface RegistryEnrichment {
  kind: 'registry';
  rcNumber: string;
  /** The authoritative name from the registry; null when the RC number is unknown. */
  registeredName: string | null;
  /** The name we extracted from the document. */
  extractedName: string | null;
  /** 0..1 similarity between extracted and registered names. */
  nameMatchScore: number;
  status: RegistryStatus;
}

export type Enrichment = FxEnrichment | RegistryEnrichment;

/** A name match at or above this score is treated as a registry-verified company. */
export const REGISTRY_NAME_MATCH_THRESHOLD = 0.8;

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

/** Build a RegistryEnrichment from a lookup result + the extracted name. */
export function buildRegistryEnrichment(params: {
  rcNumber: string;
  registeredName: string | null;
  extractedName: string | null;
}): RegistryEnrichment {
  const { rcNumber, registeredName, extractedName } = params;
  if (registeredName == null) {
    return { kind: 'registry', rcNumber, registeredName: null, extractedName, nameMatchScore: 0, status: 'not_found' };
  }
  const score = extractedName ? compareNames(extractedName, registeredName) : 0;
  return {
    kind: 'registry',
    rcNumber,
    registeredName,
    extractedName,
    nameMatchScore: score,
    status: score >= REGISTRY_NAME_MATCH_THRESHOLD ? 'verified' : 'mismatch',
  };
}

/**
 * Fold enrichment outcomes back onto a document's fields (pure). The registry
 * verdict drives the company name's routing with a DISTINCT signal per outcome,
 * so a reviewer can tell apart "an authority contradicts the name" (mismatch),
 * "the RC number isn't on file" (not_found), and "we couldn't reach the registry"
 * (unavailable) — all route to review (external-source safe failure), while a
 * verified match records a positive `registryVerified` corroboration signal
 * without changing status. Returns a new DocumentResult with the enrichments
 * attached. Confidence is left untouched (the model's own certainty stays honest;
 * the routing reason is external).
 */
export function applyEnrichment(doc: DocumentResult, enrichments: Enrichment[]): DocumentResult {
  const registry = enrichments.find((e): e is RegistryEnrichment => e.kind === 'registry');
  const review = 'needs_review' as const;

  const fields = doc.fields.map((f) => {
    if (!registry || f.fieldPath !== 'companyName') return f;
    switch (registry.status) {
      case 'verified':
        return { ...f, signals: { ...f.signals, registryVerified: true } };
      case 'mismatch':
        return { ...f, status: review, signals: { ...f.signals, registryMismatch: true } };
      case 'not_found':
        return { ...f, status: review, signals: { ...f.signals, registryNotFound: true } };
      case 'unavailable':
        return { ...f, status: review, signals: { ...f.signals, registryUnavailable: true } };
    }
  });

  return { ...doc, fields, enrichments };
}
