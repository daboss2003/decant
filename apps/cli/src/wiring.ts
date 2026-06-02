import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import {
  DocumentPipeline,
  RuleValidationService,
  HeuristicConfidenceService,
  ThresholdRoutingService,
  registry,
  KNOWN_DOC_TYPES,
  type PipelineResult,
} from '@decant/core';
import { GoogleGenAIClient, GeminiClassifyService, GeminiExtractionService, type PageImageStore } from '@decant/gemini';
import { createPrismaClient, savePipelineResult } from '@decant/db';

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

/** Wire the real Gemini-backed pipeline over a given image store (plan §8 adapters). */
export function buildPipeline(apiKey: string, store: PageImageStore): DocumentPipeline {
  const client = new GoogleGenAIClient(apiKey);
  return new DocumentPipeline(
    {
      classify: new GeminiClassifyService(client, store, { knownTypes: [...KNOWN_DOC_TYPES] }),
      extraction: new GeminiExtractionService(client, store, registry),
      validation: new RuleValidationService(registry),
      confidence: new HeuristicConfidenceService(),
      routing: new ThresholdRoutingService(),
    },
    { knownTypes: KNOWN_DOC_TYPES, minClassifyConfidence: 0.5 },
  );
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
