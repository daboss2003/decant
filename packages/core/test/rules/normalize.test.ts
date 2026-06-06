import { describe, it, expect } from 'vitest';
import { normalizeDate, normalizeCurrency, toMinor } from '../../src/rules/normalize';

describe('normalizeDate (NG day-first)', () => {
  it('keeps ISO dates', () => {
    expect(normalizeDate('2026-05-01')).toBe('2026-05-01');
  });

  it('parses dd/MM/yyyy as DAY-first (the whole point)', () => {
    expect(normalizeDate('03/04/2026')).toBe('2026-04-03'); // 3 April, NOT 4 March
  });

  it('parses other separators and single-digit forms', () => {
    expect(normalizeDate('13-04-2026')).toBe('2026-04-13');
    expect(normalizeDate('3/4/2026')).toBe('2026-04-03');
    expect(normalizeDate('01.02.2026')).toBe('2026-02-01');
  });

  it('parses month-name dates', () => {
    expect(normalizeDate('03 Apr 2026')).toBe('2026-04-03');
    expect(normalizeDate('Apr 03, 2026')).toBe('2026-04-03');
  });

  it('returns null for garbage / missing / impossible dates', () => {
    expect(normalizeDate('not a date')).toBeNull();
    expect(normalizeDate('99/99/9999')).toBeNull();
    expect(normalizeDate('')).toBeNull();
    expect(normalizeDate(null)).toBeNull();
  });
});

describe('normalizeCurrency', () => {
  it('maps NGN variants', () => {
    expect(normalizeCurrency('₦')).toBe('NGN');
    expect(normalizeCurrency('Naira')).toBe('NGN');
    expect(normalizeCurrency('ngn')).toBe('NGN');
  });

  it('accepts ISO codes, rejects junk', () => {
    expect(normalizeCurrency('USD')).toBe('USD');
    expect(normalizeCurrency('dollars')).toBeNull();
    expect(normalizeCurrency(null)).toBeNull();
  });
});

describe('toMinor', () => {
  it('converts major units to integer minor units', () => {
    expect(toMinor(1234.5)).toBe(123450);
    expect(toMinor(0)).toBe(0);
    expect(toMinor(null)).toBeNull();
  });
});
