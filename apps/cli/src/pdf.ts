import { mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as mupdf from 'mupdf';
import { isTextFormat, loadDocumentText } from './doc-text';

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

/** Extract the born-digital TEXT layer of each PDF page (mupdf, NO AI/OCR). Empty for scanned pages. */
export async function extractPdfText(pdfPath: string): Promise<string[]> {
  const doc = mupdf.Document.openDocument(new Uint8Array(await readFile(pdfPath)), 'application/pdf');
  try {
    const out: string[] = [];
    for (let i = 0; i < doc.countPages(); i++) {
      out.push(doc.loadPage(i).toStructuredText('preserve-whitespace').asText());
    }
    return out;
  } finally {
    doc.destroy();
  }
}

/**
 * Expand inputs into aligned per-page IMAGES + TEXT. PDFs are rasterized (for
 * classify + scanned fallback) AND have their text layer extracted; plain images
 * carry no text. The extraction service then reads exact text for born-digital
 * pages and only falls back to the vision model for scanned/image pages.
 */
export async function toPages(paths: string[]): Promise<{ images: string[]; texts: string[] }> {
  const images: string[] = [];
  const texts: string[] = [];
  for (const p of paths) {
    if (isPdf(p)) {
      const [imgs, txts] = await Promise.all([rasterizePdf(p), extractPdfText(p)]);
      imgs.forEach((img, i) => {
        images.push(img);
        texts.push(txts[i] ?? '');
      });
    } else if (isTextFormat(p)) {
      // Born-digital text format (md/html/xml/svg/txt/csv/…): read the exact text
      // (no AI). NO image is produced — classify + extract both run from the text.
      images.push(p); // the source ref (not loaded as an image on the text path)
      texts.push((await loadDocumentText(p)) ?? '');
    } else {
      images.push(p);
      texts.push(''); // a raster image has no text layer → vision/OCR path
    }
  }
  return { images, texts };
}
