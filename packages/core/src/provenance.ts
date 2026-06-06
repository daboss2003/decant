/**
 * Field provenance via OCR alignment (plan §2/§5). Gemini-drawn boxes are
 * unreliable, so we recover each field's location by aligning its value/quote to
 * OCR word tokens. This file is the pure alignment algorithm; the OCR source is
 * an injected `OcrProvider` (see services.ts).
 */
import type { Bbox } from '@decant/schemas';
export type { Bbox }; // re-export so `@decant/core`'s public surface is unchanged

export interface OcrToken {
  pageIndex: number;
  text: string;
  bbox: Bbox;
}

export interface FieldProvenance {
  pageIndex: number;
  bbox: Bbox;
}

/**
 * Normalize text for matching: numbers → canonical numeric string (so "1,075.00"
 * matches "1075"); other text → lowercased alphanumerics (so "CAFE  NEABLE!"
 * matches "cafe neable").
 */
function norm(s: string): string {
  const t = s.toLowerCase().trim();
  const numeric = t.replace(/[₦$£€,\s]/g, '');
  if (/^-?\d+(\.\d+)?$/.test(numeric)) {
    const n = Number(numeric);
    return Number.isNaN(n) ? numeric : String(n);
  }
  return t.replace(/[^a-z0-9]/g, '');
}

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

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - levenshtein(a, b) / maxLen;
}

function unionBbox(tokens: OcrToken[]): Bbox {
  const x0 = Math.min(...tokens.map((t) => t.bbox.x));
  const y0 = Math.min(...tokens.map((t) => t.bbox.y));
  const x1 = Math.max(...tokens.map((t) => t.bbox.x + t.bbox.w));
  const y1 = Math.max(...tokens.map((t) => t.bbox.y + t.bbox.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export interface AlignOptions {
  /** Minimum normalized similarity to accept a match (default 0.8). */
  threshold?: number;
  /** Max consecutive tokens a value may span (default 6). */
  maxWindow?: number;
}

/**
 * Find the bounding box of `value` within the OCR tokens by matching against the
 * best contiguous run of tokens (per page). Returns null if nothing matches well.
 */
export function alignValueToTokens(value: string, tokens: OcrToken[], opts: AlignOptions = {}): FieldProvenance | null {
  const target = norm(value);
  if (!target) return null;
  const threshold = opts.threshold ?? 0.8;
  const maxWindow = opts.maxWindow ?? 6;

  // Group by page, preserving order.
  const byPage = new Map<number, OcrToken[]>();
  for (const t of tokens) {
    const arr = byPage.get(t.pageIndex) ?? [];
    arr.push(t);
    byPage.set(t.pageIndex, arr);
  }

  let best: { sim: number; provenance: FieldProvenance } | null = null;
  for (const [pageIndex, pageTokens] of byPage) {
    for (let i = 0; i < pageTokens.length; i++) {
      let concat = '';
      for (let w = 0; w < maxWindow && i + w < pageTokens.length; w++) {
        const window = pageTokens.slice(i, i + w + 1);
        concat = norm(window.map((t) => t.text).join(' '));
        const sim = similarity(target, concat);
        if (sim >= threshold && (!best || sim > best.sim)) {
          best = { sim, provenance: { pageIndex, bbox: unionBbox(window) } };
        }
      }
    }
  }
  return best?.provenance ?? null;
}
