import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GoldDoc, GoldField } from '@decant/eval';

/**
 * Load a gold set of REAL (redacted) documents from a directory, so the eval can
 * measure accuracy/calibration on real data instead of the synthetic generator
 * (plan §4). Each labeled document is a pair:
 *   <name>.<ext>        the document  (image, PDF, or any text format — md/html/…)
 *   <name>.gold.json    the labels    { "docType": "...", "fields": { path: { kind, expected } } }
 *
 * The source file is ingested through the normal multi-format path (PDF → mupdf,
 * born-digital text → exact text, raster → vision), so redacted PDFs/scans/text
 * all work. Keep the docs PII-free/redacted — this directory is shareable.
 */
const SOURCE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.md', '.markdown', '.html', '.htm', '.xml', '.svg', '.txt', '.csv', '.json', '.yaml', '.yml'];

export interface GoldDirEntry {
  gold: GoldDoc;
  /** Absolute path to the source document. */
  source: string;
}

function asGoldFields(v: unknown, file: string): Record<string, GoldField> {
  if (!v || typeof v !== 'object') throw new Error(`gold-dir: ${file} "fields" must be an object`);
  for (const [path, gf] of Object.entries(v as Record<string, unknown>)) {
    const f = gf as Partial<GoldField>;
    if (!f || typeof f.kind !== 'string' || !('expected' in f)) {
      throw new Error(`gold-dir: ${file} field "${path}" must be { kind, expected }`);
    }
  }
  return v as Record<string, GoldField>;
}

/** Read every `<name>.gold.json` in `dir`, pair it with its source document. */
export async function loadGoldDir(dir: string): Promise<GoldDirEntry[]> {
  const files = await readdir(dir);
  const entries: GoldDirEntry[] = [];
  for (const f of files) {
    if (!f.endsWith('.gold.json')) continue;
    const id = f.slice(0, -'.gold.json'.length);
    const sidecar = JSON.parse(await readFile(join(dir, f), 'utf8')) as { docType?: unknown; fields?: unknown };
    if (typeof sidecar.docType !== 'string') throw new Error(`gold-dir: ${f} must have a string "docType"`);
    const fields = asGoldFields(sidecar.fields, f);
    const source = SOURCE_EXTS.map((e) => join(dir, id + e)).find((p) => existsSync(p));
    if (!source) throw new Error(`gold-dir: no source document for ${f} (expected ${id}.<ext>)`);
    entries.push({ gold: { id, docType: sidecar.docType, fields }, source });
  }
  if (entries.length === 0) throw new Error(`gold-dir: no *.gold.json label files found in ${dir}`);
  return entries.sort((a, b) => a.gold.id.localeCompare(b.gold.id));
}
