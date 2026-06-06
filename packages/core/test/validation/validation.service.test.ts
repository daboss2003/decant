import { describe, it, expect } from 'vitest';
import { RuleValidationService } from '../../src/validation/validation.service';
import { registry } from '../../src/registry.instance';
import type { ExtractedDocument } from '../../src/services';
import { receiptRaw } from '../test-fixtures';

const svc = new RuleValidationService(registry);
const typedDoc = (raw: unknown): ExtractedDocument => ({ documentId: 'd', docType: 'receipt', mode: 'typed', raw });

describe('RuleValidationService', () => {
  it('clean receipt: no failed GATEs, not flagged for reclassification', () => {
    const out = svc.validate(
      typedDoc(receiptRaw({ subtotal: 1000, tax: 75, total: 1075, lines: [{ qty: 2, unit: 500, lineTotal: 1000 }] })),
    );
    expect(out.results.filter((r) => r.severity === 'GATE' && !r.passed)).toHaveLength(0);
    expect(out.reclassify).toBe(false);
  });

  it('two failed GATEs → flagged for reclassification (coarse mis-route proxy)', () => {
    // line items (500) ≠ subtotal (1000)  AND  subtotal+tax (1000) ≠ total (9999)
    const out = svc.validate(
      typedDoc(receiptRaw({ subtotal: 1000, tax: 0, total: 9999, lines: [{ qty: 1, unit: 500, lineTotal: 500 }] })),
    );
    expect(out.results.filter((r) => r.severity === 'GATE' && !r.passed).length).toBeGreaterThanOrEqual(2);
    expect(out.reclassify).toBe(true);
  });

  it('generic doc has no rules and never reclassifies', () => {
    const out = svc.validate({ documentId: 'g', docType: 'unknown', mode: 'generic', raw: {} });
    expect(out.results).toHaveLength(0);
    expect(out.reclassify).toBe(false);
  });
});
