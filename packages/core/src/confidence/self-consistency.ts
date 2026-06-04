import { flattenExtraction } from './flatten';
import type { DocumentSegment } from '../segment';
import type { ExtractedDocument, ExtractionService } from '../services';

const valueKey = (v: unknown): string => (v == null ? '∅' : String(v).trim().toLowerCase());

/**
 * Wrap an ExtractionService to run N samples and measure per-field
 * SELF-CONSISTENCY (plan §3): the agreement across independent samples is a
 * model-internal confidence signal, independent of the model's self-reported
 * confidence — when the model "changes its mind" across samples, that field is
 * less trustworthy and should route to review. Samples run CONCURRENTLY (the
 * fan-out the plan earmarked for the queue).
 *
 * Returns the most representative sample (the medoid — the run whose values best
 * match the per-field majority, so the returned extraction is coherent, not a
 * frankenstein) plus a per-fieldPath `agreement` ∈ [0,1] that the
 * ConfidenceService folds in. N>1 only differs if the base samples stochastically
 * (temperature > 0).
 */
export class SelfConsistencyExtractionService implements ExtractionService {
  constructor(
    private readonly base: ExtractionService,
    private readonly samples = 3,
  ) {}

  async extract(segment: DocumentSegment, uploadId: string): Promise<ExtractedDocument> {
    const n = Math.max(1, this.samples);
    const runs = await Promise.all(Array.from({ length: n }, () => this.base.extract(segment, uploadId)));
    if (n === 1) return runs[0]!;

    const flats = runs.map((r) => flattenExtraction(r.raw));
    const paths = new Set(flats.flat().map((f) => f.fieldPath));

    // Per-field majority value + agreement (fraction of samples that agreed).
    const agreement: Record<string, number> = {};
    const majority: Record<string, string> = {};
    for (const p of paths) {
      const keys = flats.map((f) => valueKey(f.find((x) => x.fieldPath === p)?.value));
      const counts = new Map<string, number>();
      for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
      let topKey = keys[0]!;
      let top = 0;
      for (const [k, c] of counts) if (c > top) ((top = c), (topKey = k));
      agreement[p] = top / keys.length;
      majority[p] = topKey;
    }

    // Medoid: the run whose values most often equal the per-field majority.
    let best = 0;
    let bestScore = -1;
    runs.forEach((_, i) => {
      const flat = flats[i]!;
      let s = 0;
      for (const p of paths) if (valueKey(flat.find((x) => x.fieldPath === p)?.value) === majority[p]) s++;
      if (s > bestScore) ((bestScore = s), (best = i));
    });

    return { ...runs[best]!, agreement };
  }
}
