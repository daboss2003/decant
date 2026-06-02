import { z } from 'zod';

/**
 * Decant — shared schema primitives.
 *
 * Zod is the single source of truth (plan §5): one schema feeds the Gemini
 * `responseJsonSchema`, the NestJS DTOs, the MCP tool I/O, and (flat variants)
 * the MCP elicitation `requestedSchema`.
 */

/** A calibrated or model-reported probability in [0,1]. */
export const Confidence = z.number().min(0).max(1);
export type Confidence = z.infer<typeof Confidence>;

/** Where a value came from on the page — drives the review-UI overlay + audit. */
export const Provenance = z.object({
  pageIndex: z.number().int().nonnegative(),
  /** Normalized [0,1] box; null when the value isn't grounded to a region. */
  bbox: z
    .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
    .nullable()
    .default(null),
});
export type Provenance = z.infer<typeof Provenance>;

/**
 * The atomic unit Gemini returns per field during TYPED extraction:
 * the value + the model's self-reported confidence + the text it quoted.
 *
 * Self-reported confidence is poorly calibrated raw — it is one INPUT to the
 * confidence fusion (plan §3), never the final score.
 *
 * We capture only `sourceQuote` from the model — NOT page/bbox. Per plan §2/§5,
 * model-drawn boxes are unreliable, so `Provenance` (page + bbox) is recovered
 * post-extraction by aligning the value to OCR tokens, not self-reported here.
 */
export function extractedField<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    value: value.nullable(),
    modelConfidence: Confidence,
    sourceQuote: z
      .string()
      .nullable()
      .describe('verbatim text the model read this value from'),
  });
}

/** ISO-4217 currency code, e.g. "NGN". */
export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/);

/** Canonical date as ISO yyyy-mm-dd. Extraction returns free text; we normalize. */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Canonical money = integer MINOR units (kobo/cents) + currency. Never float (§6.4).
 * Switch `minor` to `bigint` if statement sums can exceed 2^53.
 */
export const Money = z.object({
  minor: z.number().int(),
  currency: CurrencyCode,
});
export type Money = z.infer<typeof Money>;
