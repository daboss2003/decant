import { describe, it, expect } from 'vitest';
import { normPath, fieldMatches } from './field-match';

describe('normPath', () => {
  it('lowercases and strips a trailing "Minor" per segment', () => {
    expect(normPath('totalMinor')).toBe('total');
    expect(normPath('transactions.3.balanceMinor')).toBe('transactions.3.balance');
    expect(normPath('merchantName')).toBe('merchantname');
  });
});

describe('fieldMatches', () => {
  it('matches canonical rule field ↔ extraction self path', () => {
    expect(fieldMatches('totalMinor', 'total')).toBe(true);
  });

  it('a container rule affects all descendant fields', () => {
    expect(fieldMatches('transactions', 'transactions.5.balance')).toBe(true);
    expect(fieldMatches('lineItems', 'lineItems.0.unitPrice')).toBe(true);
  });

  it('a row-level rule affects ONLY that row (per-row localization)', () => {
    expect(fieldMatches('transactions.3.balanceMinor', 'transactions.3.balance')).toBe(true);
    expect(fieldMatches('transactions.3.balanceMinor', 'transactions.4.balance')).toBe(false);
  });

  it('does not match unrelated fields', () => {
    expect(fieldMatches('total', 'subtotal')).toBe(false);
  });
});
