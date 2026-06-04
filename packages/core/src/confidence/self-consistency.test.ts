import { describe, it, expect } from 'vitest';
import { SelfConsistencyExtractionService } from './self-consistency';
import { flattenExtraction } from './flatten';
import { HeuristicConfidenceService } from './confidence.service';
import type { DocumentSegment } from '../segment';
import type { ExtractionService, ExtractedDocument } from '../services';

const seg = { pageRange: [0, 0], docType: 'receipt', isGeneric: false, confidence: 1 } as unknown as DocumentSegment;
const ef = (value: unknown) => ({ value, modelConfidence: 0.9, sourceQuote: String(value) });

/** A fake base whose `total` flips on the 2nd of 3 calls (2/3 agree on 1075). */
function flakyBase(): ExtractionService {
  let call = 0;
  return {
    async extract() {
      call++;
      return {
        documentId: 'd',
        docType: 'receipt',
        mode: 'typed',
        raw: { merchantName: ef('Acme'), total: ef(call === 2 ? 9999 : 1075) },
      };
    },
  };
}

describe('SelfConsistencyExtractionService', () => {
  it('measures per-field agreement and returns the majority (medoid) sample', async () => {
    const out = await new SelfConsistencyExtractionService(flakyBase(), 3).extract(seg, 'u');
    expect(out.agreement?.merchantName).toBe(1); // unanimous
    expect(out.agreement?.total).toBeCloseTo(2 / 3, 5); // 2 of 3 agreed
    // the returned (coherent) sample uses the majority total
    expect(flattenExtraction(out.raw).find((f) => f.fieldPath === 'total')?.value).toBe(1075);
  });

  it('N=1 is a pass-through (no agreement, no extra calls)', async () => {
    let calls = 0;
    const base: ExtractionService = {
      async extract() {
        calls++;
        return { documentId: 'd', docType: 'receipt', mode: 'typed', raw: { total: ef(1075) } } satisfies ExtractedDocument;
      },
    };
    const out = await new SelfConsistencyExtractionService(base, 1).extract(seg, 'u');
    expect(calls).toBe(1);
    expect(out.agreement).toBeUndefined();
  });
});

describe('confidence folds self-consistency agreement', () => {
  it('low agreement scales the field confidence down (→ more likely to route to review)', async () => {
    const svc = new HeuristicConfidenceService();
    const doc: ExtractedDocument = {
      documentId: 'd',
      docType: 'receipt',
      mode: 'typed',
      raw: { total: ef(1075), merchantName: ef('Acme') },
      agreement: { total: 1 / 3, merchantName: 1 },
    };
    const scored = await svc.score(doc, { results: [], reclassify: false }, 1);
    const total = scored.find((f) => f.fieldPath === 'total');
    const merchant = scored.find((f) => f.fieldPath === 'merchantName');
    expect(total?.confidence).toBeCloseTo(0.9 * (1 / 3), 5); // base 0.9 × agreement
    expect(total?.signals.selfConsistency).toBeCloseTo(1 / 3, 5);
    expect(merchant?.confidence).toBeCloseTo(0.9, 5); // unanimous → unchanged
  });
});
