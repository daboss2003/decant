import { z } from 'zod';
import {
  buildVerification,
  unavailableVerification,
  type AuthorityRecord,
  type DocumentResult,
} from '@decant/core';
import { asString, fieldValue, type Enricher } from './enrichers';
import type { ExternalMcpClient } from './mcp-client';

/**
 * The verification adapter (plan §8). Decant owns the reusable machinery —
 * compare an extracted field to an authority, decide verified/mismatch/not_found/
 * inactive/unavailable, fold the verdict into the trust loop, and audit it. To add
 * a NEW verification source (a real CAC RC→name registry, a tax-ID service, a bank
 * NUBAN→account-name check, …) a consumer implements ONE function: a
 * `VerificationLookup`. Everything else is handled.
 *
 *   const cacVerifier = makeVerifier({
 *     name: 'cac',
 *     field: 'companyName',                                  // compared + routed on failure
 *     applies: (doc) => !!fieldValue(doc, 'rcNumber'),       // optional gate
 *     lookup: async (doc) => {                               // <-- the only thing you write
 *       const rc = String(fieldValue(doc, 'rcNumber'));
 *       const rec = await myCacApi(rc);                      // your data source (HTTP, DB, MCP, …)
 *       return rec ? { value: rec.name, standing: rec.status, reference: rc, source: 'cac' } : null;
 *     },
 *   });
 *
 * Contract: return an AuthorityRecord (`value` null ⇒ not found), `null` ⇒ not
 * found, or THROW ⇒ the source was unavailable (still routed to review — never
 * silently dropped).
 */
export type VerificationLookup = (doc: DocumentResult) => Promise<AuthorityRecord | null>;

export interface VerifierConfig {
  /** Verifier id — drives the per-field signal/audit key (e.g. 'cac', 'taxId'). */
  name: string;
  /** Document field to compare against the authority and route on failure (e.g. 'companyName'). */
  field: string;
  /** The lookup you implement. */
  lookup: VerificationLookup;
  /** Run only when this returns true (default: the doc has a non-empty `field`). */
  applies?: (doc: DocumentResult) => boolean;
  /** Match threshold 0..1 (default 0.8). */
  threshold?: number;
  /** Custom comparator (default: company-name similarity); pass an exact comparator for IDs. */
  compare?: (a: string, b: string) => number;
  /** Source label recorded when the lookup throws (unavailable). */
  source?: string;
}

/** Wrap a lookup function into an Enricher that folds its verdict into the trust loop. */
export function makeVerifier(config: VerifierConfig): Enricher {
  const applies = config.applies ?? ((doc: DocumentResult) => asString(fieldValue(doc, config.field)) != null);
  return {
    async enrich(doc) {
      if (!applies(doc)) return [];
      const extractedValue = asString(fieldValue(doc, config.field));
      try {
        const record = await config.lookup(doc);
        return [
          buildVerification({ verifier: config.name, field: config.field, extractedValue, record, threshold: config.threshold, compare: config.compare }),
        ];
      } catch {
        // unreachable/erroring source — record it (NOT a silent skip) so the field still routes to review
        return [unavailableVerification(config.name, config.field, extractedValue, config.source)];
      }
    },
  };
}

export interface McpLookupConfig<R> {
  /** Tool name to call on the MCP server. */
  tool: string;
  /** Build the tool arguments from the document. */
  args: (doc: DocumentResult) => Record<string, unknown>;
  /** Validate the (untrusted) tool result. */
  schema: z.ZodType<R>;
  /** Map a validated result to an AuthorityRecord (null ⇒ not found); throw ⇒ unavailable. */
  map: (result: R) => AuthorityRecord | null;
}

/**
 * Build a VerificationLookup that consults an external MCP server tool — the bridge
 * between the verification adapter and the MCP *client* role. A malformed result
 * throws (→ unavailable). Lets the registry (and any MCP-backed source) be a
 * verifier without bespoke wiring.
 */
export function mcpLookup<R>(client: ExternalMcpClient, cfg: McpLookupConfig<R>): VerificationLookup {
  return async (doc) => {
    const parsed = cfg.schema.safeParse(await client.callTool<unknown>(cfg.tool, cfg.args(doc)));
    if (!parsed.success) throw new Error(`${cfg.tool}: unexpected result shape`); // → unavailable
    return cfg.map(parsed.data);
  };
}
