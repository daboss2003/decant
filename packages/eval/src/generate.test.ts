import { describe, it, expect } from 'vitest';
import { generateGoldSet } from './generate';
import { matchField } from './match';

describe('generateGoldSet', () => {
  it('produces the requested per-type counts', () => {
    const docs = generateGoldSet({ receipts: 24, bankStatements: 12, cac: 12 });
    expect(docs).toHaveLength(48);
    const byType = docs.reduce<Record<string, number>>((a, d) => ((a[d.docType] = (a[d.docType] ?? 0) + 1), a), {});
    expect(byType).toEqual({ receipt: 24, bank_statement: 12, cac: 12 });
  });

  it('is deterministic for a given seed (reproducible gold set)', () => {
    expect(generateGoldSet({ seed: 7 })).toEqual(generateGoldSet({ seed: 7 }));
    expect(generateGoldSet({ seed: 1 })).not.toEqual(generateGoldSet({ seed: 2 }));
  });

  it('spreads rendering difficulty so confidence can vary', () => {
    const diffs = new Set(generateGoldSet({ seed: 3 }).map((d) => d.difficulty));
    expect(diffs.has('clean')).toBe(true);
    expect(diffs.size).toBeGreaterThan(1);
  });

  it('emits self-consistent, well-typed labels (receipt total reconciles; gold matches itself)', () => {
    for (const d of generateGoldSet({ seed: 5 })) {
      for (const [, gf] of Object.entries(d.fields)) {
        // a label must match itself under its own match kind
        expect(matchField(gf.kind, gf.expected, gf.expected)).toBe(true);
      }
      if (d.docType === 'receipt') {
        const sub = Number(d.fields.subtotal!.expected);
        const tax = Number(d.fields.tax!.expected);
        const total = Number(d.fields.total!.expected);
        expect(Math.round((sub + tax) * 100) / 100).toBe(total);
      }
    }
  });
});
