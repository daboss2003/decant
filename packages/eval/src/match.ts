import { toMinor, normalizeDate, normalizeCurrency } from '@decant/core';

/**
 * Field matchers for scoring predictions against gold (plan §4 — the gotchas
 * that silently corrupt accuracy). Reuses the app's own normalizers so eval and
 * runtime share one source of truth.
 */
export type MatchKind = 'string' | 'money' | 'number' | 'date' | 'currency' | 'id' | 'bool';

export interface MatchOptions {
  stringThreshold?: number; // default 0.9
  moneyToleranceMinor?: number; // default 1 (±1 kobo)
}

const isNil = (v: unknown): boolean => v === null || v === undefined;
const norm = (s: string): string => s.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[n] ?? 0;
}

/** Normalized edit-distance similarity in [0,1] (1 = identical after normalization). */
export function stringSimilarity(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (x === y) return 1;
  const maxLen = Math.max(x.length, y.length);
  return maxLen === 0 ? 1 : 1 - levenshtein(x, y) / maxLen;
}

/** True when the predicted value matches the gold value under the field's match kind. */
export function matchField(kind: MatchKind, expected: unknown, predicted: unknown, opts: MatchOptions = {}): boolean {
  if (isNil(expected)) return isNil(predicted); // null is a valid answer; predicting a value is a fabrication
  if (isNil(predicted)) return false;

  switch (kind) {
    case 'money': {
      const e = toMinor(Number(expected));
      const p = toMinor(Number(predicted));
      if (e === null || p === null) return false;
      return Math.abs(e - p) <= (opts.moneyToleranceMinor ?? 1);
    }
    case 'number':
      return Math.abs(Number(expected) - Number(predicted)) < 1e-9;
    case 'date': {
      const e = normalizeDate(String(expected));
      return e !== null && e === normalizeDate(String(predicted));
    }
    case 'currency': {
      const e = normalizeCurrency(String(expected));
      return e !== null && e === normalizeCurrency(String(predicted));
    }
    case 'id':
      return String(expected).trim() === String(predicted).trim(); // exact — fuzzy hides real ID errors
    case 'bool':
      return Boolean(expected) === Boolean(predicted);
    case 'string':
      return stringSimilarity(String(expected), String(predicted)) >= (opts.stringThreshold ?? 0.9);
  }
  return false;
}
