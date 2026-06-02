import { z } from 'zod';
import { Confidence } from './common';

/**
 * Output of the single BATCHED Flash-Lite classify call over ALL pages of an
 * upload (plan §2, stage 3). One call — not one-per-page — so the model reasons
 * about page boundaries holistically. We group contiguous same-type pages into
 * Documents in code (see @decant/core `segmentPages`).
 */
export const PageClassification = z.object({
  pageIndex: z.number().int().nonnegative(),
  /** A registered doc_type id, or `unknown` → generic fallback (§6.0). */
  docType: z.string(),
  confidence: Confidence,
});
export type PageClassification = z.infer<typeof PageClassification>;

export const ClassifyOutput = z.object({
  pages: z.array(PageClassification),
});
export type ClassifyOutput = z.infer<typeof ClassifyOutput>;

// NOTE: `min/max` on `confidence` become `minimum/maximum`, which Gemini does
// NOT enforce — clamp/validate confidence into [0,1] after parsing the response.

/** Sentinel doc_type for anything unrecognised / below the routing threshold. */
export const UNKNOWN_DOC_TYPE = 'unknown';
