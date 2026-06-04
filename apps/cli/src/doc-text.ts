import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

/**
 * Text-format ingestion (no AI, no OCR). Born-digital documents — Markdown, HTML,
 * XML, SVG, plain text, CSV, JSON, YAML — already CONTAIN their text, so we read
 * it directly and feed the exact characters to BOTH classify and extract (cheaper +
 * no OCR error, and no wasteful render-text-to-image round-trip). Markup formats
 * are stripped to their text content.
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
