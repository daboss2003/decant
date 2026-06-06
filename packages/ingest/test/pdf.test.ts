import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import { rasterizePdf, isPdf, toPageImages, extractPdfText, toPages } from '../src/pdf';

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

describe('extractPdfText (born-digital text layer, no AI)', () => {
  it('extracts the exact per-page text from a born-digital PDF', async () => {
    const pdf = await makePdf(['CAFE NEABLE TOTAL 500', 'Page two body']);
    const texts = await extractPdfText(pdf);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain('CAFE NEABLE');
    expect(texts[0]).toContain('500');
    expect(texts[1]).toContain('Page two');
  }, 30_000);

  it('toPages aligns images + text; plain images get empty text', async () => {
    const pdf = await makePdf(['Born digital page']);
    const { images, texts } = await toPages([pdf, '/some/scan.png']);
    expect(images).toHaveLength(2);
    expect(texts[0]).toContain('Born digital'); // PDF page → has text
    expect(texts[1]).toBe(''); // image → no text layer
  }, 30_000);

  it('toPages handles a text format (md): exact text, NO image rendered', async () => {
    const md = join(mkdtempSync(join(tmpdir(), 'decant-md-')), 'r.md');
    writeFileSync(md, '# Receipt\nTOTAL 500');
    const { images, texts } = await toPages([md]);
    expect(images).toHaveLength(1);
    expect(images[0]).toBe(md); // source ref kept; no fake image produced
    expect(texts[0]).toContain('TOTAL 500'); // exact text for classify + extraction
  }, 30_000);
});
