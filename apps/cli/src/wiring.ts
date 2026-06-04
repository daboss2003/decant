import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  DocumentPipeline,
  RuleValidationService,
  HeuristicConfidenceService,
  SelfConsistencyExtractionService,
  ThresholdRoutingService,
  registry,
  KNOWN_DOC_TYPES,
  type PipelineResult,
  type Calibration,
  type CalibrationSet,
} from '@decant/core';
import { GoogleGenAIClient, GeminiClassifyService, GeminiExtractionService, type PageImageStore } from '@decant/gemini';
import { TesseractOcrProvider } from '@decant/ocr';
import {
  ExternalMcpClient,
  EnrichmentService,
  FxEnricher,
  registryVerifier,
  mcpRegistryLookup,
  FX_DEMO_SERVER,
  REGISTRY_DEMO_SERVER,
  FX_LIVE_SERVER,
  REGISTRY_GLEIF_SERVER,
} from '@decant/enrich';
import { createPrismaClient, savePipelineResult } from '@decant/db';

const here = dirname(fileURLToPath(import.meta.url));

/** Minimal .env loader — walks up from cwd looking for .env / packages/gemini/.env. */
export function loadDotenv(): void {
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth++) {
    for (const rel of ['.env', 'packages/gemini/.env']) {
      const p = resolve(dir, rel);
      if (!existsSync(p)) continue;
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && m[1] && process.env[m[1]] === undefined) {
          process.env[m[1]] = (m[2] ?? '').replace(/^["']|["']$/g, '');
        }
      }
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
}

export function requireApiKey(): string {
  loadDotenv();
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error('GEMINI_API_KEY not set (looked in env, .env, packages/gemini/.env)');
    process.exit(1);
  }
  return key;
}

/**
 * Load a fitted calibrator if one exists (from `DECANT_CALIBRATION` or the
 * default sidecar output), else undefined → the pipeline uses raw scores.
 */
export function loadCalibration(): Calibration | CalibrationSet | undefined {
  const path = process.env.DECANT_CALIBRATION ?? resolve(process.cwd(), '../../reports/eval/calibration.json');
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Calibration | CalibrationSet;
  } catch {
    return undefined;
  }
}

/**
 * Wire the real Gemini-backed pipeline over a given image store (plan §8 adapters).
 * Pass a `calibration` to make routing use calibrated probabilities; omit it for
 * the eval pipeline (which must measure RAW scores to fit the calibrator).
 */
export function buildPipeline(
  apiKey: string,
  store: PageImageStore,
  calibration?: Calibration | CalibrationSet,
  opts: { ocr?: boolean; samples?: number } = {},
): DocumentPipeline {
  const client = new GoogleGenAIClient(apiKey);
  const samples = Math.max(1, opts.samples ?? 1);
  // N-sample self-consistency needs stochastic sampling (temperature > 0) to vary.
  const geminiExtraction = new GeminiExtractionService(client, store, registry, samples > 1 ? { temperature: 0.4 } : {});
  const extraction = samples > 1 ? new SelfConsistencyExtractionService(geminiExtraction, samples) : geminiExtraction;
  return new DocumentPipeline(
    {
      classify: new GeminiClassifyService(client, store, { knownTypes: [...KNOWN_DOC_TYPES] }),
      extraction,
      validation: new RuleValidationService(registry),
      confidence: new HeuristicConfidenceService({ calibration }),
      routing: new ThresholdRoutingService(),
      // PageImageStore is structurally an ImageBytesLoader, so the same store
      // that feeds Gemini also feeds OCR (off by default — Tesseract is heavy).
      ocr: opts.ocr ? new TesseractOcrProvider(store) : undefined,
    },
    { knownTypes: KNOWN_DOC_TYPES, minClassifyConfidence: 0.5 },
  );
}

export interface EnrichmentHandle {
  service: EnrichmentService;
  close(): Promise<void>;
}

/**
 * Wire the MCP *client*-role enrichment (plan §8), spawning the FX + registry
 * MCP servers over stdio. `live` swaps the deterministic demo servers for real
 * ones (open.er-api.com FX + GLEIF registry). Decant consumes these the same way
 * an MCP host consumes Decant.
 */
export function buildEnrichment(opts: { live?: boolean } = {}): EnrichmentHandle {
  const tsx = resolve(here, '../node_modules/.bin/tsx');
  const fxServer = opts.live ? FX_LIVE_SERVER : FX_DEMO_SERVER;
  const registryServer = opts.live ? REGISTRY_GLEIF_SERVER : REGISTRY_DEMO_SERVER;
  // No `env` — the SDK's default allowlist (PATH/HOME/…) already lets tsx run, and
  // these servers need nothing more. Never forward process.env: it would leak
  // GEMINI_API_KEY etc. to a spawned child (a real third-party server especially).
  const fxClient = new ExternalMcpClient({ command: tsx, args: [fxServer] });
  const registryClient = new ExternalMcpClient({ command: tsx, args: [registryServer] });
  // Demo/live registry is just one provider (mcpRegistryLookup); a library consumer
  // can pass their own VerificationLookup to registryVerifier instead.
  const service = new EnrichmentService([new FxEnricher(fxClient, 'USD'), registryVerifier(mcpRegistryLookup(registryClient))]);
  return {
    service,
    close: async () => {
      await Promise.all([fxClient.close(), registryClient.close()]);
    },
  };
}

/**
 * Close the loop: persist a pipeline result into the same dev DB the review UI
 * reads, and copy the first page image into the web app's public dir so it shows
 * beside the flagged fields. Returns the new document id for the review URL.
 */
export async function saveToReviewQueue(
  result: PipelineResult,
  pageImagePaths: string[],
  nPages: number,
): Promise<{ uploadId: string; documentId: string | null }> {
  const dbUrl = `file:${resolve(process.cwd(), '../../packages/db/prisma/dev.db')}`;
  const prisma = createPrismaClient(dbUrl);
  try {
    const uploadId = await savePipelineResult(prisma, { sourceType: 'photo', nPages, result });

    // Copy EVERY raster page image into the web public dir so multi-page docs can be
    // paged through in review; text-format pages (no raster) become null placeholders.
    const uploadsDir = resolve(process.cwd(), '../../apps/web/public/uploads');
    mkdirSync(uploadsDir, { recursive: true });
    const refs = await Promise.all(
      pageImagePaths.map(async (p, i) => {
        if (!/\.(png|jpe?g|webp)$/i.test(p)) return null;
        const ref = `/uploads/${uploadId}-${i}.png`;
        await sharp(p).png().toFile(resolve(uploadsDir, `${uploadId}-${i}.png`));
        return ref;
      }),
    );
    const firstRef = refs.find((r) => r) ?? null;
    if (firstRef) {
      await prisma.upload.update({ where: { id: uploadId }, data: { imageRef: firstRef, pageImageRefs: refs } });
    }

    const firstDoc = await prisma.document.findFirst({ where: { uploadId }, orderBy: { pageStart: 'asc' } });
    return { uploadId, documentId: firstDoc?.id ?? null };
  } finally {
    await prisma.$disconnect();
  }
}
