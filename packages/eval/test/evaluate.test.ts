import { describe, it, expect } from 'vitest';
import type { DocumentResult, FieldStatus } from '@decant/core';
import { evaluate, type EvalCase, type GoldDoc } from '../src/evaluate';

type F = { fieldPath: string; value: unknown; confidence: number; status: FieldStatus };
const doc = (docType: string, fields: F[]): DocumentResult => ({
  documentId: 'd',
  docType,
  mode: 'typed',
  pageRange: [0, 0],
  reclassify: false,
  ruleResults: [],
  fields: fields.map((f) => ({ ...f, signals: {} })),
});

const gold: GoldDoc = {
  id: 'g',
  docType: 'receipt',
  fields: {
    merchantName: { kind: 'string', expected: 'CAFE NEABLE' },
    total: { kind: 'money', expected: 1075 },
  },
};

describe('evaluate', () => {
  it('a correct, auto-approved doc scores 100% with zero silent errors', () => {
    const cases: EvalCase[] = [
      {
        gold,
        predicted: doc('receipt', [
          { fieldPath: 'merchantName', value: 'CAFE NEABLE', confidence: 0.97, status: 'auto_approved' },
          { fieldPath: 'total', value: 1075, confidence: 0.97, status: 'auto_approved' },
        ]),
      },
    ];
    const r = evaluate(cases);
    expect(r.classificationAccuracy).toBe(1);
    expect(r.fieldAccuracy).toBe(1);
    expect(r.silentErrorRate).toBe(0);
  });

  it('a wrong total that was FLAGGED counts as a safe failure, not a silent error', () => {
    const cases: EvalCase[] = [
      {
        gold,
        predicted: doc('receipt', [
          { fieldPath: 'merchantName', value: 'CAFE NEABLE', confidence: 0.97, status: 'auto_approved' },
          { fieldPath: 'total', value: 9999, confidence: 0.15, status: 'needs_review' }, // wrong, but caught
        ]),
      },
    ];
    const r = evaluate(cases);
    expect(r.fieldAccuracy).toBe(0.5); // total wrong
    expect(r.silentErrorRate).toBe(0); // nothing wrong was auto-approved
    expect(r.safeFailureRate).toBe(1); // the one wrong field was flagged
  });

  it('a wrong total that was AUTO-APPROVED is a silent error (the worst case)', () => {
    const cases: EvalCase[] = [
      {
        gold,
        predicted: doc('receipt', [
          { fieldPath: 'merchantName', value: 'CAFE NEABLE', confidence: 0.97, status: 'auto_approved' },
          { fieldPath: 'total', value: 9999, confidence: 0.97, status: 'auto_approved' }, // wrong AND confident
        ]),
      },
    ];
    const r = evaluate(cases);
    expect(r.silentErrorRate).toBe(0.5);
    expect(r.safeFailureRate).toBe(0);
  });
});
