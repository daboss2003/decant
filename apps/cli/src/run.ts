import { resolve } from 'node:path';
import { requireApiKey, buildPipeline, saveToReviewQueue, loadCalibration } from './wiring';
import { FsPageImageStore } from './fs-image-store';

async function main(): Promise<void> {
  const apiKey = requireApiKey();

  const argv = process.argv.slice(2);
  const save = argv.includes('--save');
  const ocr = argv.includes('--ocr');
  const files = argv.filter((a) => !a.startsWith('--')).map((f) => resolve(f));
  if (files.length === 0) {
    console.error('usage: tsx src/run.ts <image-or-pdf> [more pages…] [--save] [--ocr]');
    process.exit(1);
  }

  const uploadId = 'cli-upload';
  const pages = files.map((f, i) => ({ pageIndex: i, imageRef: f }));
  const store = new FsPageImageStore(new Map([[uploadId, files]]));
  const calibration = loadCalibration();
  const pipeline = buildPipeline(apiKey, store, calibration, { ocr });

  const calLabel = !calibration
    ? 'uncalibrated'
    : 'method' in calibration
      ? `calibrated: ${calibration.method}`
      : 'calibrated: per-type';
  console.error(`Processing ${files.length} page(s) through the pipeline (${calLabel}${ocr ? ', OCR provenance' : ''})…\n`);
  const result = await pipeline.process(uploadId, pages);

  for (const doc of result.documents) {
    console.log(`=== ${doc.docType} (${doc.mode})  pages ${doc.pageRange[0]}-${doc.pageRange[1]} ===`);
    if (doc.reclassify) console.log('  ⚠ flagged for reclassification (possible mis-route)');
    const auto = doc.fields.filter((f) => f.status === 'auto_approved').length;
    console.log(`  ${auto}/${doc.fields.length} fields auto-approved; the rest need review\n`);
    for (const f of doc.fields) {
      const mark = f.status === 'auto_approved' ? '✓' : '⚑';
      console.log(`  ${mark} ${f.fieldPath} = ${JSON.stringify(f.value)}   (conf ${f.confidence.toFixed(2)}, ${f.status})`);
    }
    const failed = doc.ruleResults.filter((r) => !r.passed);
    if (failed.length) console.log(`\n  rules failed: ${failed.map((r) => `${r.rule}[${r.severity}]`).join(', ')}`);
    console.log('');
  }

  if (save && files[0]) {
    const { documentId } = await saveToReviewQueue(result, files[0], files.length);
    console.log(
      documentId
        ? `Saved to review queue → http://localhost:3000/documents/${documentId}`
        : 'Saved to review queue (no document produced).',
    );
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
