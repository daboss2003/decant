import { resolve } from 'node:path';
import { requireApiKey, buildPipeline } from './wiring';
import { FsPageImageStore } from './fs-image-store';

async function main(): Promise<void> {
  const apiKey = requireApiKey();

  const files = process.argv.slice(2).map((f) => resolve(f));
  if (files.length === 0) {
    console.error('usage: tsx src/run.ts <image-or-pdf> [more pages…]');
    process.exit(1);
  }

  const uploadId = 'cli-upload';
  const pages = files.map((f, i) => ({ pageIndex: i, imageRef: f }));
  const store = new FsPageImageStore(new Map([[uploadId, files]]));
  const pipeline = buildPipeline(apiKey, store);

  console.error(`Processing ${files.length} page(s) through the pipeline…\n`);
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
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
