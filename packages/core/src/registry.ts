import { z } from 'zod';

/**
 * The schema registry (plan §1 / §6): doc_type → { schema, rules, calibrator }.
 * Code-first for v1 (type-safe, simple); DB-backed later.
 *
 * @decant/core is transport-agnostic — both apps/api (REST) and apps/mcp (MCP)
 * adapt over it (plan §8). Adding a document type = adding a RegistryEntry.
 */

export type RuleSeverity = 'GATE' | 'SIGNAL';

/**
 * One domain-rule outcome. Doubles as a calibration feature (§3/§6):
 * [GATE] failure forces review; [SIGNAL] failure lowers confidence.
 */
export interface RuleResult {
  rule: string;
  severity: RuleSeverity;
  passed: boolean;
  /** Canonical field paths implicated (drives routing + the review UI). */
  fields: string[];
  detail?: string;
}

/** A domain rule runs over the CANONICAL document and returns one result. */
export type DomainRule<TCanonical> = (doc: TCanonical) => RuleResult;

// Defaults are `any` (not `unknown`) so a heterogeneous registry of entries with
// different concrete types is assignable: `normalize`/`rules` are contravariant
// in their params, so `unknown` would reject a concrete entry. Each entry is
// still fully typed at its definition site (see receipt.entry.ts); consumers
// narrow by `docType` at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface RegistryEntry<TExtraction = any, TCanonical = any> {
  docType: string;
  version: string;
  /** Given to Gemini as `responseJsonSchema` (wrapped, self-reporting fields). */
  extractionSchema: z.ZodType<TExtraction>;
  /** Normalized values the rules run on. */
  canonicalSchema: z.ZodType<TCanonical>;
  /** Coerce raw extraction → canonical (money→minor units, dates→ISO). */
  normalize: (extracted: TExtraction) => TCanonical;
  rules: DomainRule<TCanonical>[];
  /** Field paths a human may correct (MCP elicitation / review UI). */
  reviewFields: readonly string[];
  /** Points at this type's calibrator params (calibration.json) — §3/§4. */
  calibratorRef?: string;
  /** JSON Schema for Gemini: z.toJSONSchema(extractionSchema), adapter-cleaned. */
  toGeminiJsonSchema: () => unknown;
}

export interface Registry {
  get(docType: string): RegistryEntry | undefined;
  has(docType: string): boolean;
  list(): string[];
}

export function createRegistry(entries: RegistryEntry[]): Registry {
  const byType = new Map(entries.map((e) => [e.docType, e]));
  return {
    get: (t) => byType.get(t),
    has: (t) => byType.has(t),
    list: () => [...byType.keys()],
  };
}
