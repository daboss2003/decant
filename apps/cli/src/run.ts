import { resolve } from 'node:path';
import { requireApiKey, buildPipeline, buildEnrichment, saveToReviewQueue, loadCalibration } from './wiring';
import { FsPageImageStore } from './fs-image-store';
import { toPages } from './pdf';

async function main(): Promise<void> {
  const apiKey = requireApiKey();

  const argv = process.argv.slice(2);
  const save = argv.includes('--save');
  const ocr = argv.includes('--ocr');
  const enrichLive = argv.includes('--enrich-live');
  const enrich = enrichLive || argv.includes('--enrich');
  const samplesIdx = argv.indexOf('--samples');
  const samples = samplesIdx >= 0 ? Number(argv[samplesIdx + 1]) || 1 : 1;
  const files = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--samples').map((f) => resolve(f));
  if (files.length === 0) {
    console.error('usage: tsx src/run.ts <image|pdf|md|html|xml|svg|txt|csv …> [more …] [--save] [--ocr] [--enrich|--enrich-live] [--samples N]');
    process.exit(1);
  }

  const uploadId = 'cli-upload';
  // PDFs → per-page PNGs (for classify + scanned fallback) + born-digital text layer
  // (mupdf, no AI); images pass through with no text. Extraction reads exact text
  // for born-digital pages and only uses the vision model for scanned/image pages.
  const { images: pageImages, texts: pageTexts } = await toPages(files);
  const pages = pageImages.map((f, i) => ({ pageIndex: i, imageRef: f }));
  const store = new FsPageImageStore(new Map([[uploadId, pageImages]]), new Map([[uploadId, pageTexts]]));
  const calibration = loadCalibration();
  const pipeline = buildPipeline(apiKey, store, calibration, { ocr, samples });

  const calLabel = !calibration
    ? 'uncalibrated'
    : 'method' in calibration
      ? `calibrated: ${calibration.method}`
      : 'calibrated: per-type';
  console.error(
    `Processing ${files.length} page(s) through the pipeline (${calLabel}${ocr ? ', OCR provenance' : ''}${samples > 1 ? `, ${samples}× self-consistency` : ''}${enrich ? `, MCP enrichment (${enrichLive ? 'live' : 'demo'})` : ''})…\n`,
  );
  let result = await pipeline.process(uploadId, pages);

  if (enrich) {
    if (enrichLive) {
      console.error(
        'Live enrichment ON: currency codes → open.er-api.com, company names → api.gleif.org. No money amounts and no secrets (e.g. GEMINI_API_KEY) are sent.',
      );
    }
    const { service, close } = buildEnrichment({ live: enrichLive });
    try {
      const documents = await Promise.all(result.documents.map((d) => service.enrich(d)));
      result = { ...result, documents };
    } finally {
      await close();
    }
  }

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
    if (doc.enrichments?.length) {
      const summary = doc.enrichments.map((e) =>
        e.kind === 'fx'
          ? `fx ${e.field} ≈ ${e.baseAmount} ${e.base}`
          : `${e.verifier}(${e.field}) ${e.status}${e.authoritativeValue ? ` → ${e.authoritativeValue}` : ''}`,
      );
      console.log(`  enrichment: ${summary.join('; ')}`);
    }
    console.log('');
  }

  if (save && pageImages[0]) {
    // Persist the rasterized first page (PDFs) / the image so the review UI shows it.
    const { documentId } = await saveToReviewQueue(result, pageImages[0], pageImages.length);
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
