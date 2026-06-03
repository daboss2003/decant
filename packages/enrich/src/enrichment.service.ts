import { applyEnrichment, type DocumentResult, type Enrichment } from '@decant/core';
import type { Enricher } from './enrichers';

/**
 * Runs the registered enrichers over a document and folds their results back
 * onto its fields (plan §8 client role). Enrichers are best-effort: one that
 * throws (e.g. an unreachable external server) is logged and skipped — external
 * enrichment must never sink a document's extraction.
 */
export class EnrichmentService {
  constructor(
    private readonly enrichers: Enricher[],
    private readonly onError: (e: unknown) => void = (e) =>
      console.error('[enrich]', e instanceof Error ? e.message : String(e)),
  ) {}

  async enrich(doc: DocumentResult): Promise<DocumentResult> {
    const results = await Promise.all(
      this.enrichers.map(async (en) => {
        try {
          return await en.enrich(doc);
        } catch (e) {
          this.onError(e);
          return [] as Enrichment[];
        }
      }),
    );
    const enrichments = results.flat();
    if (enrichments.length === 0) return doc;
    return applyEnrichment(doc, enrichments);
  }
}
