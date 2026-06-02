import { z } from 'zod';
import { Confidence } from './common';

/**
 * Generic fallback extraction (plan §6.0) for unregistered / low-confidence
 * types. Open key/value, NO domain rules, NO per-type calibration → ALWAYS
 * low-trust and ALWAYS routed to review (never auto-approved). It exists so
 * Decant accepts ANY document without pretending to be reliable on everything.
 */
export const GenericExtraction = z.object({
  type: z.string().describe("the model's free-text guess at the document type"),
  fields: z.array(
    z.object({
      name: z.string(),
      value: z.string().nullable(),
      modelConfidence: Confidence,
      sourceQuote: z.string().nullable(),
    }),
  ),
});
export type GenericExtraction = z.infer<typeof GenericExtraction>;
