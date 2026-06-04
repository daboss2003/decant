import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import sharp from 'sharp';

/**
 * Text-format ingestion (no AI, no OCR). Born-digital documents — Markdown, HTML,
 * XML, SVG, plain text, CSV, JSON, YAML — already CONTAIN their text, so we read
 * it directly and feed the exact characters to the extractor (cheaper + no OCR
 * error). Markup formats are stripped to their text content. A small preview image
 * is also rendered so the existing vision-based classify step still works; only
 * EXTRACTION uses the text.
 */
const PLAIN = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.log', '.json', '.yaml', '.yml']);
const MARKUP = new Set(['.html', '.htm', '.xml', '.svg', '.xhtml']);

export const isTextFormat = (path: string): boolean => {
  const e = extname(path).toLowerCase();
  return PLAIN.has(e) || MARKUP.has(e);
};

/** Strip markup (HTML/XML/SVG) to readable text: drop script/style/comments, tags → spaces, decode common entities. */
function stripMarkup(s: string): string {
  return s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n')
    .trim();
}

/** Read a text-format document's text. Returns null for unsupported (binary) formats. */
export async function loadDocumentText(path: string): Promise<string | null> {
  if (!isTextFormat(path)) return null;
  const raw = await readFile(path, 'utf8');
  return MARKUP.has(extname(path).toLowerCase()) ? stripMarkup(raw) : raw;
}

const escapeXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Render a small preview PNG of the text so the vision-based classify step has an image. */
export async function renderTextPreview(text: string): Promise<Buffer> {
  const lines = text.split('\n').slice(0, 50).map((l) => l.slice(0, 100));
  const body = lines.map((l, i) => `<text x="16" y="${26 + i * 16}" font-size="12">${escapeXml(l)}</text>`).join('');
  const height = Math.max(80, 26 + lines.length * 16 + 16);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="${height}"><rect width="100%" height="100%" fill="#ffffff"/><g font-family="monospace" fill="#111111">${body}</g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
