import { describe, it, expect } from 'vitest';
import { matchField, stringSimilarity } from '../src/match';

describe('matchField', () => {
  it('money: equal within ±1 minor unit, else wrong', () => {
    expect(matchField('money', 1075, 1075)).toBe(true);
    expect(matchField('money', 1075, 1075.004)).toBe(true); // rounds to same kobo
    expect(matchField('money', 1075, 1080)).toBe(false);
  });

  it('date: day-first equivalence', () => {
    expect(matchField('date', '2026-04-03', '03/04/2026')).toBe(true); // 3 April both ways
    expect(matchField('date', '2026-04-03', '04/03/2026')).toBe(false); // that is 4 March
  });

  it('currency: NGN variants equal', () => {
    expect(matchField('currency', 'NGN', '₦')).toBe(true);
    expect(matchField('currency', 'NGN', 'USD')).toBe(false);
  });

  it('id: exact match only (no fuzz)', () => {
    expect(matchField('id', 'RC123456', 'RC123456')).toBe(true);
    expect(matchField('id', 'RC123456', 'rc123456')).toBe(false);
  });

  it('string: normalized fuzzy match', () => {
    expect(matchField('string', 'CAFE NEABLE', 'Cafe  Neable')).toBe(true);
    expect(matchField('string', 'Cafe Neable', 'Shoprite')).toBe(false);
  });

  it('null handling: absent is correct only when gold is null', () => {
    expect(matchField('string', null, null)).toBe(true);
    expect(matchField('string', null, 'x')).toBe(false); // fabrication
    expect(matchField('money', 1075, null)).toBe(false); // missed
  });
});

describe('stringSimilarity', () => {
  it('is 1 for identical-after-normalization and lower for different', () => {
    expect(stringSimilarity('Cafe', 'CAFE')).toBe(1);
    expect(stringSimilarity('Cafe', 'Cafx')).toBeLessThan(1);
  });
});
