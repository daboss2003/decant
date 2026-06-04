import { mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as mupdf from 'mupdf';

export const isPdf = (path: string): boolean => path.toLowerCase().endsWith('.pdf');

/**
 * Rasterize every page of a PDF to a PNG file (plan §2 ingestion) using mupdf
 * (WASM, no system deps). Returns the per-page image paths in order — so the
 * pipeline's per-page classify → segment works on multi-page PDFs, not just
 * single images. `scale` 2 ≈ 144 DPI (enough for the vision model + OCR).
 */
export async function rasterizePdf(pdfPath: string, opts: { scale?: number; outDir?: string } = {}): Promise<string[]> {
  const scale = opts.scale ?? 2;
  const dir = opts.outDir ?? mkdtempSync(join(tmpdir(), 'decant-pdf-'));
  const doc = mupdf.Document.openDocument(new Uint8Array(await readFile(pdfPath)), 'application/pdf');
  try {
    const matrix = mupdf.Matrix.scale(scale, scale);
    const out: string[] = [];
    for (let i = 0; i < doc.countPages(); i++) {
      const page = doc.loadPage(i);
      const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);
      const file = join(dir, `page-${i}.png`);
      writeFileSync(file, Buffer.from(pixmap.asPNG()));
      out.push(file);
    }
    return out;
  } finally {
    doc.destroy();
  }
}

/** Expand a list of input paths into page-image paths: PDFs rasterized, images passed through. */
export async function toPageImages(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    if (isPdf(p)) out.push(...(await rasterizePdf(p)));
    else out.push(p);
  }
  return out;
}
