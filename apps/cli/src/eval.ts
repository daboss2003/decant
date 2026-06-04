import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RECEIPT_GOLD, generateGoldSet, evaluate, renderReport, type EvalCase, type GoldDoc } from '@decant/eval';
import { requireApiKey, buildPipeline } from './wiring';
import { renderGold } from './renderers';
import { loadGoldDir } from './gold-dir';
import { toPages, FsPageImageStore } from '@decant/ingest';

/**
 * Eval harness (plan §4): ingest a labeled gold set → run the real pipeline →
 * score → emit results.json for the calibration sidecar.
 *
 * Flags:
 *   --gold-dir <dir>         score REAL (redacted) docs from a directory of
 *                            <name>.<ext> + <name>.gold.json pairs (see gold-dir.ts)
 *   --static                 use the small hand-written RECEIPT_GOLD (3 docs)
 *   --seed N                 PRNG seed for the generated set (default 42)
 *   --receipts/--bank/--cac N  per-type counts (defaults 24/12/12)
 *   --type <docType>         only this type · --limit N  cap the doc count
 *   --render-only [dir]      render the SYNTHETIC images only (NO Gemini), then exit
 */
const argv = process.argv.slice(2);
const has = (f: string): boolean => argv.includes(f);
const numFlag = (f: string, def: number): number => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : def;
};
const strFlag = (f: string, def: string): string => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1]! : def;
};

interface Prepared {
  gold: GoldDoc;
  images: string[];
  texts: string[];
  label: string;
}

function applyFilters(items: Prepared[]): Prepared[] {
  const type = strFlag('--type', '');
  let out = type ? items.filter((i) => i.gold.docType === type) : items;
  const limit = numFlag('--limit', 0);
  if (limit > 0) out = out.slice(0, limit);
  return out;
}

/** Generated/static synthetic gold → rendered to images. */
function generatedGold(): GoldDoc[] {
  return has('--static')
    ? RECEIPT_GOLD
    : generateGoldSet({ seed: numFlag('--seed', 42), receipts: numFlag('--receipts', 24), bankStatements: numFlag('--bank', 12), cac: numFlag('--cac', 12) });
}

async function main(): Promise<void> {
  const goldDir = strFlag('--gold-dir', '');

  // Render-only inspects the SYNTHETIC images; not applicable to a real gold dir.
  if (!goldDir && has('--render-only')) {
    const out = resolve(process.cwd(), strFlag('--render-only', '../../reports/eval/samples'));
    mkdirSync(out, { recursive: true });
    const gold = applyFilters(generatedGold().map((g) => ({ gold: g, images: [], texts: [], label: '' })));
    for (const { gold: g } of gold) {
      const { buffer, ext } = await renderGold(g);
      writeFileSync(join(out, `${g.id}.${ext}`), buffer);
    }
    console.log(`Rendered ${gold.length} images → ${out} (no extraction performed)`);
    return;
  }

  // Build the prepared list: real docs ingested from disk, or synthetic rendered.
  let prepared: Prepared[];
  if (goldDir) {
    const entries = await loadGoldDir(resolve(process.cwd(), goldDir));
    prepared = [];
    for (const { gold, source } of entries) {
      const { images, texts } = await toPages([source]);
      prepared.push({ gold, images, texts, label: 'real' });
    }
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'decant-eval-'));
    prepared = [];
    for (const g of generatedGold()) {
      const { buffer, ext } = await renderGold(g);
      const img = join(dir, `${g.id}.${ext}`);
      writeFileSync(img, buffer);
      prepared.push({ gold: g, images: [img], texts: [''], label: (g as { difficulty?: string }).difficulty ?? 'clean' });
    }
  }
  prepared = applyFilters(prepared);

  const composition = prepared.reduce<Record<string, number>>((a, p) => ((a[p.gold.docType] = (a[p.gold.docType] ?? 0) + 1), a), {});
  console.error(`Gold set${goldDir ? ` (real: ${goldDir})` : ''}: ${prepared.length} docs — ${Object.entries(composition).map(([t, n]) => `${t}:${n}`).join(', ')}`);

  const apiKey = requireApiKey();
  const store = new FsPageImageStore(
    new Map(prepared.map((p) => [p.gold.id, p.images])),
    new Map(prepared.map((p) => [p.gold.id, p.texts])),
  );
  const pipeline = buildPipeline(apiKey, store);

  const cases: EvalCase[] = [];
  let n = 0;
  let failed = 0;
  for (const p of prepared) {
    console.error(`extracting ${p.gold.id} (${p.label}) … [${++n}/${prepared.length}]`);
    try {
      const pages = p.images.map((img, i) => ({ pageIndex: i, imageRef: img }));
      const result = await pipeline.process(p.gold.id, pages);
      const predicted = result.documents[0];
      if (predicted) cases.push({ gold: p.gold, predicted });
    } catch (e) {
      if ((e as { dailyQuotaExhausted?: boolean }).dailyQuotaExhausted) {
        console.error(`  ! daily Gemini quota exhausted at ${p.gold.id} — stopping early, scoring the ${cases.length} extracted so far.`);
        break;
      }
      failed++;
      console.error(`  ! ${p.gold.id} failed, skipping: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    }
  }
  if (failed) console.error(`\n${failed}/${prepared.length} docs failed (skipped); scoring the ${cases.length} that succeeded.`);
  if (cases.length === 0) {
    console.error('No documents were extracted — aborting before writing results.');
    process.exit(1);
  }

  const report = evaluate(cases);
  console.log(`\n${renderReport(report)}\n`);

  const outDir = resolve(process.cwd(), '../../reports/eval');
  mkdirSync(outDir, { recursive: true });
  const items = report.perField.map((p) => ({ confidence: p.confidence, correct: p.correct, docType: p.docType }));
  writeFileSync(join(outDir, 'results.json'), JSON.stringify({ items }, null, 2));
  console.log(`Wrote ${items.length} scored fields → reports/eval/results.json`);
  console.log('Fit calibration:  packages/calibrate/.venv/bin/python -m calibrate.fit --in reports/eval/results.json --out reports/eval/');
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
