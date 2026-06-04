import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { isTextFormat, loadDocumentText, renderTextPreview } from './doc-text';

const tmpFile = (name: string, content: string): string => {
  const p = join(mkdtempSync(join(tmpdir(), 'decant-doctext-')), name);
  writeFileSync(p, content);
  return p;
};

describe('multi-format text ingestion (no AI/OCR)', () => {
  it('recognizes born-digital text formats (not rasters/PDF)', () => {
    for (const f of ['a.md', 'a.markdown', 'a.html', 'a.htm', 'a.xml', 'a.svg', 'a.txt', 'a.csv', 'a.json', 'a.yaml']) {
      expect(isTextFormat(f)).toBe(true);
    }
    for (const f of ['a.png', 'a.jpg', 'a.pdf']) expect(isTextFormat(f)).toBe(false);
  });

  it('reads markdown / plain text verbatim', async () => {
    const p = tmpFile('r.md', '# Receipt\n\nTOTAL  500.00');
    expect(await loadDocumentText(p)).toContain('TOTAL  500.00');
  });

  it('strips HTML to its text content (drops tags, script/style, decodes entities)', async () => {
    const html = tmpFile('r.html', '<html><head><style>.x{color:red}</style></head><body><h1>CAFE</h1><p>TOTAL&nbsp;500 &amp; tax</p><script>evil()</script></body></html>');
    const t = (await loadDocumentText(html)) ?? '';
    expect(t).toContain('CAFE');
    expect(t).toContain('TOTAL 500 & tax');
    expect(t).not.toContain('<h1>');
    expect(t).not.toContain('color:red');
    expect(t).not.toContain('evil()');
  });

  it('extracts text from XML/SVG', async () => {
    expect(await loadDocumentText(tmpFile('r.svg', '<svg xmlns="..."><text x="0">Invoice 42</text></svg>'))).toContain('Invoice 42');
    expect(await loadDocumentText(tmpFile('r.xml', '<doc><total>500</total></doc>'))).toContain('500');
  });

  it('returns null for unsupported (binary) formats', async () => {
    expect(await loadDocumentText('/x/scan.png')).toBeNull();
  });

  it('renders a preview PNG for the classify step', async () => {
    const meta = await sharp(await renderTextPreview('Hello\nWorld\nTOTAL 500')).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBeGreaterThan(0);
  });
});
