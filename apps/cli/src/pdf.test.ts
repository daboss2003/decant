import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import { rasterizePdf, isPdf, toPageImages } from './pdf';

async function makePdf(pages: string[]): Promise<string> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = pdf.addPage([320, 420]);
    page.drawText(text, { x: 40, y: 360, size: 20, font });
  }
  const file = join(mkdtempSync(join(tmpdir(), 'decant-pdf-test-')), 'doc.pdf');
  writeFileSync(file, await pdf.save());
  return file;
}

describe('rasterizePdf (mupdf)', () => {
  it('rasterizes every page of a multi-page PDF to PNGs', async () => {
    const pdf = await makePdf(['Page one', 'Page two', 'Page three']);
    const pages = await rasterizePdf(pdf, { scale: 2 });
    expect(pages).toHaveLength(3);
    for (const p of pages) {
      const meta = await sharp(p).metadata();
      expect(meta.format).toBe('png');
      expect(meta.width).toBeGreaterThan(100); // 320pt * 2 scale
      expect(meta.height).toBeGreaterThan(100);
    }
  }, 30_000);

  it('toPageImages expands PDFs and passes images through', async () => {
    const pdf = await makePdf(['A', 'B']);
    const expanded = await toPageImages([pdf, '/some/image.png']);
    expect(expanded).toHaveLength(3); // 2 PDF pages + 1 image
    expect(isPdf(expanded[0]!)).toBe(false); // rasterized to .png
    expect(expanded[2]).toBe('/some/image.png');
  }, 30_000);
});
