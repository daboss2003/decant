import { describe, it, expect } from 'vitest';
import { DocumentPipeline } from './pipeline';
import { RuleValidationService } from './validation/validation.service';
import { HeuristicConfidenceService } from './confidence/confidence.service';
import { ThresholdRoutingService } from './routing/routing.service';
import { registry, KNOWN_DOC_TYPES } from './registry.instance';
import type { ClassifyService, ExtractionService, PageInput } from './services';
import type { DocumentSegment } from './segment';
import { receiptRaw } from './test-fixtures';

const genericRaw = {
  type: 'rent_receipt',
  fields: [{ name: 'landlord', value: 'Mr A', modelConfidence: 0.9, sourceQuote: 'Mr A' }],
};

/** Wire the real Validation/Confidence/Routing services with FAKE classify+extract. */
function makePipeline(
  pages: Array<{ pageIndex: number; docType: string; confidence: number }>,
  extractFor: (segment: DocumentSegment) => unknown,
): DocumentPipeline {
  const classify: ClassifyService = { async classify() { return { pages }; } };
  const extraction: ExtractionService = {
    async extract(segment) {
      return {
        documentId: `doc-${segment.pageRange[0]}`,
        docType: segment.isGeneric ? 'unknown' : segment.docType,
        mode: segment.isGeneric ? 'generic' : 'typed',
        raw: extractFor(segment),
      };
    },
  };
  return new DocumentPipeline(
    {
      classify,
      extraction,
      validation: new RuleValidationService(registry),
      confidence: new HeuristicConfidenceService(),
      routing: new ThresholdRoutingService(),
    },
    { knownTypes: KNOWN_DOC_TYPES, minClassifyConfidence: 0.5 },
  );
}

const onePage: PageInput[] = [{ pageIndex: 0, imageRef: 'p0' }];
const cleanReceipt = () =>
  receiptRaw({ subtotal: 1000, tax: 75, total: 1075, lines: [{ qty: 2, unit: 500, lineTotal: 1000 }] });

describe('DocumentPipeline (end-to-end, no Gemini)', () => {
  it('segments a mixed upload into a typed receipt + a generic doc', async () => {
    const pipeline = makePipeline(
      [
        { pageIndex: 0, docType: 'receipt', confidence: 1 },
        { pageIndex: 1, docType: 'rent_receipt', confidence: 0.9 }, // unregistered → generic
      ],
      (seg) => (seg.isGeneric ? genericRaw : cleanReceipt()),
    );
    const result = await pipeline.process('u1', [
      { pageIndex: 0, imageRef: 'p0' },
      { pageIndex: 1, imageRef: 'p1' },
    ]);

    expect(result.documents).toHaveLength(2);
    expect(result.documents[0]?.docType).toBe('receipt');
    expect(result.documents[0]?.mode).toBe('typed');
    expect(result.documents[1]?.mode).toBe('generic');
  });

  it('clean receipt with a confident classification → all fields auto-approved', async () => {
    const pipeline = makePipeline([{ pageIndex: 0, docType: 'receipt', confidence: 1 }], cleanReceipt);
    const { documents } = await pipeline.process('u1', onePage);
    expect(documents[0]?.fields.every((f) => f.status === 'auto_approved')).toBe(true);
  });

  it('a receipt whose total does not reconcile → money fields need review, others do not (per-field routing)', async () => {
    const pipeline = makePipeline([{ pageIndex: 0, docType: 'receipt', confidence: 1 }], () =>
      receiptRaw({ subtotal: 1000, tax: 75, total: 9999, lines: [{ qty: 2, unit: 500, lineTotal: 1000 }] }),
    );
    const { documents } = await pipeline.process('u1', onePage);
    const fields = documents[0]!.fields;
    expect(fields.find((f) => f.fieldPath === 'total')?.status).toBe('needs_review');
    expect(fields.find((f) => f.fieldPath === 'merchantName')?.status).toBe('auto_approved');
  });

  it('every field in a generic document routes to review', async () => {
    const pipeline = makePipeline([{ pageIndex: 0, docType: 'rent_receipt', confidence: 0.9 }], () => genericRaw);
    const { documents } = await pipeline.process('u1', onePage);
    expect(documents[0]?.mode).toBe('generic');
    expect(documents[0]?.fields.length).toBeGreaterThan(0);
    expect(documents[0]?.fields.every((f) => f.status === 'needs_review')).toBe(true);
  });
});
