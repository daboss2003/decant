import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { RECEIPT_GOLD, evaluate, renderReport, type EvalCase, type GoldDoc } from '@decant/eval';
import { requireApiKey, buildPipeline } from './wiring';
import { FsPageImageStore } from './fs-image-store';

const fmtMoney = (n: number): string => n.toLocaleString('en-US', { minimumFractionDigits: 2 });
const isoToDayFirst = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`; // print NG day-first to exercise the date parser
};

/** Render a receipt image from a gold record (truth → printed document). */
function receiptSvg(g: GoldDoc): string {
  const f = g.fields;
  const merchant = String(f.merchantName?.expected ?? '');
  const date = isoToDayFirst(String(f.transactionDate?.expected ?? '2026-01-01'));
  const subtotal = Number(f.subtotal?.expected ?? 0);
  const tax = Number(f.tax?.expected ?? 0);
  const total = Number(f.total?.expected ?? 0);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="360">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <g font-family="monospace" fill="#111111">
      <text x="28" y="48" font-size="24" font-weight="bold">${merchant}</text>
      <text x="28" y="86" font-size="16">Date: ${date}</text>
      <line x1="28" y1="104" x2="492" y2="104" stroke="#999"/>
      <text x="28" y="140" font-size="16">1 x Item            ${fmtMoney(subtotal)}</text>
      <line x1="28" y1="158" x2="492" y2="158" stroke="#999"/>
      <text x="28" y="196" font-size="16">Subtotal            ${fmtMoney(subtotal)}</text>
      <text x="28" y="226" font-size="16">VAT                 ${fmtMoney(tax)}</text>
      <text x="28" y="262" font-size="20" font-weight="bold">TOTAL               ${fmtMoney(total)}</text>
      <text x="28" y="300" font-size="16">Currency: NGN   Paid: Cash</text>
    </g>
  </svg>`;
}

async function main(): Promise<void> {
  const apiKey = requireApiKey();
  const dir = mkdtempSync(join(tmpdir(), 'decant-eval-'));
  const cases: EvalCase[] = [];

  for (const gold of RECEIPT_GOLD) {
    const png = join(dir, `${gold.id}.png`);
    await sharp(Buffer.from(receiptSvg(gold))).png().toFile(png);

    const store = new FsPageImageStore(new Map([[gold.id, [png]]]));
    const pipeline = buildPipeline(apiKey, store);
    console.error(`extracting ${gold.id} …`);
    const result = await pipeline.process(gold.id, [{ pageIndex: 0, imageRef: png }]);
    const predicted = result.documents[0];
    if (predicted) cases.push({ gold, predicted });
  }

  const report = evaluate(cases);
  console.log(`\n${renderReport(report)}\n`);

  // Emit results.json (per-field confidence + correctness) for the calibration sidecar.
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
