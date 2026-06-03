import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  DocumentPipeline,
  RuleValidationService,
  HeuristicConfidenceService,
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
  RegistryEnricher,
  FX_DEMO_SERVER,
  REGISTRY_DEMO_SERVER,
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
  opts: { ocr?: boolean } = {},
): DocumentPipeline {
  const client = new GoogleGenAIClient(apiKey);
  return new DocumentPipeline(
    {
      classify: new GeminiClassifyService(client, store, { knownTypes: [...KNOWN_DOC_TYPES] }),
      extraction: new GeminiExtractionService(client, store, registry),
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
 * Wire the MCP *client*-role enrichment (plan §8) against the bundled demo
 * registry + FX servers, spawned over stdio. Decant consumes other MCP servers
 * the same way an MCP host consumes Decant.
 */
export function buildEnrichment(): EnrichmentHandle {
  const tsx = resolve(here, '../node_modules/.bin/tsx');
  // No `env` — the SDK's default allowlist (PATH/HOME/…) already lets tsx run, and
  // the demo servers need nothing more. Never forward process.env: it would leak
  // GEMINI_API_KEY etc. to a spawned child (a real third-party server especially).
  const fxClient = new ExternalMcpClient({ command: tsx, args: [FX_DEMO_SERVER] });
  const registryClient = new ExternalMcpClient({ command: tsx, args: [REGISTRY_DEMO_SERVER] });
  const service = new EnrichmentService([new FxEnricher(fxClient, 'USD'), new RegistryEnricher(registryClient)]);
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
  firstImagePath: string,
  nPages: number,
): Promise<{ uploadId: string; documentId: string | null }> {
  const dbUrl = `file:${resolve(process.cwd(), '../../packages/db/prisma/dev.db')}`;
  const prisma = createPrismaClient(dbUrl);
  try {
    const uploadId = await savePipelineResult(prisma, { sourceType: 'photo', nPages, result });

    const uploadsDir = resolve(process.cwd(), '../../apps/web/public/uploads');
    mkdirSync(uploadsDir, { recursive: true });
    await sharp(firstImagePath).png().toFile(resolve(uploadsDir, `${uploadId}.png`)); // images only (PDFs would need rasterizing)
    await prisma.upload.update({ where: { id: uploadId }, data: { imageRef: `/uploads/${uploadId}.png` } });

    const firstDoc = await prisma.document.findFirst({ where: { uploadId }, orderBy: { pageStart: 'asc' } });
    return { uploadId, documentId: firstDoc?.id ?? null };
  } finally {
    await prisma.$disconnect();
  }
}
