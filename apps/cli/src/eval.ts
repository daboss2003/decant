import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  RECEIPT_GOLD,
  generateGoldSet,
  evaluate,
  renderReport,
  type EvalCase,
  type GeneratedGoldDoc,
} from '@decant/eval';
import { requireApiKey, buildPipeline } from './wiring';
import { renderGold } from './renderers';
import { FsPageImageStore } from './fs-image-store';

/**
 * Eval harness (plan §4): render a labeled gold set → run the real pipeline →
 * score → emit results.json for the calibration sidecar.
 *
 * Flags:
 *   --static                 use the small hand-written RECEIPT_GOLD (3 docs)
 *   --seed N                 PRNG seed for the generated set (default 42)
 *   --receipts/--bank/--cac N  per-type counts (defaults 24/12/12)
 *   --type <docType>         only this type
 *   --limit N                cap the number of docs (cost control)
 *   --render-only [dir]      render images only (NO Gemini), then exit
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

function buildGoldSet(): GeneratedGoldDoc[] {
  let docs: GeneratedGoldDoc[] = has('--static')
    ? RECEIPT_GOLD.map((g) => ({ ...g, difficulty: 'clean' as const }))
    : generateGoldSet({
        seed: numFlag('--seed', 42),
        receipts: numFlag('--receipts', 24),
        bankStatements: numFlag('--bank', 12),
        cac: numFlag('--cac', 12),
      });
  const type = strFlag('--type', '');
  if (type) docs = docs.filter((g) => g.docType === type);
  const limit = numFlag('--limit', 0);
  if (limit > 0) docs = docs.slice(0, limit);
  return docs;
}

async function main(): Promise<void> {
  const gold = buildGoldSet();
  const composition = gold.reduce<Record<string, number>>((a, g) => ((a[g.docType] = (a[g.docType] ?? 0) + 1), a), {});
  console.error(`Gold set: ${gold.length} docs — ${Object.entries(composition).map(([t, n]) => `${t}:${n}`).join(', ')}`);

  // Render-only: write images for inspection, no API calls.
  if (has('--render-only')) {
    const out = resolve(process.cwd(), strFlag('--render-only', '../../reports/eval/samples'));
    mkdirSync(out, { recursive: true });
    for (const g of gold) {
      const { buffer, ext } = await renderGold(g);
      writeFileSync(join(out, `${g.id}.${g.difficulty}.${ext}`), buffer);
    }
    console.log(`Rendered ${gold.length} images → ${out} (no extraction performed)`);
    return;
  }

  const apiKey = requireApiKey();
  const dir = mkdtempSync(join(tmpdir(), 'decant-eval-'));

  // Render every doc first, then run one pipeline over all of them.
  const pages = new Map<string, string[]>();
  for (const g of gold) {
    const { buffer, ext } = await renderGold(g);
    const img = join(dir, `${g.id}.${ext}`);
    writeFileSync(img, buffer);
    pages.set(g.id, [img]);
  }
  const pipeline = buildPipeline(apiKey, new FsPageImageStore(pages));

  const cases: EvalCase[] = [];
  let n = 0;
  let failed = 0;
  for (const g of gold) {
    console.error(`extracting ${g.id} (${g.difficulty}) … [${++n}/${gold.length}]`);
    try {
      const result = await pipeline.process(g.id, [{ pageIndex: 0, imageRef: pages.get(g.id)![0]! }]);
      const predicted = result.documents[0];
      if (predicted) cases.push({ gold: g, predicted });
    } catch (e) {
      if ((e as { dailyQuotaExhausted?: boolean }).dailyQuotaExhausted) {
        console.error(`  ! daily Gemini quota exhausted at ${g.id} — stopping early, scoring the ${cases.length} extracted so far.`);
        break;
      }
      failed++;
      console.error(`  ! ${g.id} failed, skipping: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    }
  }
  if (failed) console.error(`\n${failed}/${gold.length} docs failed (skipped); scoring the ${cases.length} that succeeded.`);
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
