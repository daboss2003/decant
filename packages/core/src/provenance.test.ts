import { describe, it, expect } from 'vitest';
import { alignValueToTokens, type OcrToken } from './provenance';

const tok = (pageIndex: number, text: string, x: number, y: number, w = 0.1, h = 0.03): OcrToken => ({
  pageIndex,
  text,
  bbox: { x, y, w, h },
});

const tokens: OcrToken[] = [
  tok(0, 'CAFE', 0.1, 0.1),
  tok(0, 'NEABLE', 0.22, 0.1),
  tok(0, 'Subtotal', 0.1, 0.4),
  tok(0, '1,075.00', 0.6, 0.4),
  tok(1, 'GTBank', 0.1, 0.1),
];

describe('alignValueToTokens', () => {
  it('aligns a multi-word string to the union of its tokens', () => {
    const p = alignValueToTokens('CAFE NEABLE', tokens);
    expect(p?.pageIndex).toBe(0);
    // union of CAFE (x0.1) and NEABLE (x0.22,w0.1) → x 0.1, right edge 0.32
    expect(p?.bbox.x).toBeCloseTo(0.1);
    expect(p?.bbox.w).toBeCloseTo(0.22); // 0.32 - 0.1
  });

  it('aligns a number to a thousands-formatted token (1075 ↔ "1,075.00")', () => {
    const p = alignValueToTokens('1075', tokens);
    expect(p?.bbox.x).toBeCloseTo(0.6);
  });

  it('respects page index', () => {
    expect(alignValueToTokens('GTBank', tokens)?.pageIndex).toBe(1);
  });

  it('returns null when nothing matches well', () => {
    expect(alignValueToTokens('TotallyAbsentValue', tokens)).toBeNull();
    expect(alignValueToTokens('', tokens)).toBeNull();
  });
});
