import {
  DocumentPipeline,
  RuleValidationService,
  HeuristicConfidenceService,
  ThresholdRoutingService,
  registry,
  KNOWN_DOC_TYPES,
  type IngestJob,
  type JobQueue,
  type JobState,
  type PipelineResult,
} from '@decant/core';
import { createQueue } from '@decant/queue';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { GoogleGenAIClient, GeminiClassifyService, GeminiExtractionService } from '@decant/gemini';
import { FsPageImageStore, persistPageImages } from '@decant/ingest';
import { savePipelineResult, loadCalibration, type PrismaClient } from '@decant/db';
import { PRISMA } from './db.providers';

const logger = new Logger('IngestJob');

// Load the fitted calibrator once at boot (the same artifact the CLI uses) so REST
// uploads route on calibrated probabilities, not raw scores. Absent → raw scores.
const calibration = loadCalibration();

/** Web-served uploads dir (configurable for split deploys; defaults to the web app's public dir). */
const uploadsDir = (): string => process.env.UPLOADS_DIR ?? resolve(process.cwd(), '../../apps/web/public/uploads');

export const JOB_TRACKER = Symbol('JOB_TRACKER');
export const INGEST_QUEUE = Symbol('INGEST_QUEUE');

/**
 * In-memory job status, keyed by jobId. Process-local: with BullMQ the producer
 * and worker run in the SAME process here (single-instance), so the status the
 * worker writes is the status the API reads. A true multi-instance/horizontal
 * deploy would need a shared status store (Redis hash / a Postgres status row) —
 * out of scope for this single-host design (see IngestJob.tempDirs).
 */
export type JobTracker = Map<string, JobState>;

/** Run the real Gemini pipeline over the job's pages (classify → extract → validate → confidence → route). */
async function runPipeline(job: IngestJob): Promise<PipelineResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const store = new FsPageImageStore(new Map([[job.jobId, job.pageImages]]), new Map([[job.jobId, job.pageTexts]]));
  const client = new GoogleGenAIClient(apiKey);
  const pipeline = new DocumentPipeline(
    {
      classify: new GeminiClassifyService(client, store, { knownTypes: [...KNOWN_DOC_TYPES] }),
      extraction: new GeminiExtractionService(client, store, registry),
      validation: new RuleValidationService(registry),
      confidence: new HeuristicConfidenceService({ calibration }),
      routing: new ThresholdRoutingService(),
    },
    { knownTypes: KNOWN_DOC_TYPES, minClassifyConfidence: 0.5 },
  );
  return pipeline.process(job.jobId, job.pageImages.map((imageRef, pageIndex) => ({ pageIndex, imageRef })));
}

/** Offline dry-run: persist the ingested text as a generic doc (no model). Set DECANT_PIPELINE_MODE=echo. */
function echoResult(job: IngestJob): PipelineResult {
  const text = job.pageTexts.map((t) => t.trim()).filter(Boolean).join('\n').slice(0, 1000) || '(no text layer)';
  return {
    uploadId: job.jobId,
    documents: [
      {
        documentId: job.jobId,
        docType: 'unknown',
        mode: 'generic',
        pageRange: [0, Math.max(0, job.pageImages.length - 1)],
        reclassify: false,
        ruleResults: [],
        fields: [{ fieldPath: 'rawText', value: text, confidence: 0, status: 'needs_review', signals: { echo: true } }],
      },
    ],
  };
}

/** Remove the job's temp upload/raster dirs (best-effort). Only after the pages are persisted. */
function cleanupTempDirs(job: IngestJob): void {
  for (const d of new Set(job.tempDirs ?? [])) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort: a cleanup failure must never affect job status */
    }
  }
}

/** The job handler: ingest → (pipeline | echo) → persist → record status. Throws on failure (drives BullMQ retries). */
function makeHandler(prisma: PrismaClient, tracker: JobTracker) {
  const echo = process.env.DECANT_PIPELINE_MODE === 'echo';
  return async (job: IngestJob): Promise<void> => {
    tracker.set(job.jobId, { status: 'processing' });
    try {
      const result = echo ? echoResult(job) : await runPipeline(job);
      // Copy page images into the web-served dir so the uploaded doc shows its scan in review.
      const { refs, firstRef } = await persistPageImages(job.pageImages, { dir: uploadsDir(), urlPrefix: '/uploads', id: job.jobId });
      const uploadId = await savePipelineResult(prisma, {
        sourceType: job.sourceType,
        nPages: job.pageImages.length,
        result,
        imageRef: firstRef ?? undefined,
        pageImageRefs: refs,
      });
      const firstDoc = await prisma.document.findFirst({ where: { uploadId }, orderBy: { pageStart: 'asc' } });
      tracker.set(job.jobId, { status: 'done', uploadId, documentId: firstDoc?.id ?? null });
      cleanupTempDirs(job); // success → the temp files are no longer needed
    } catch (e) {
      // Log the real cause server-side; the open status endpoint exposes only a generic message.
      logger.error(`Job ${job.jobId} failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
      tracker.set(job.jobId, { status: 'error', error: 'processing failed' });
      // Re-throw so BullMQ counts the attempt + retries (temp files are KEPT for the retry,
      // hence cleanup-on-success only); InProcessQueue.add swallows it (status already recorded).
      throw e;
    }
  };
}

export const ingestProviders = [
  { provide: JOB_TRACKER, useFactory: (): JobTracker => new Map() },
  {
    provide: INGEST_QUEUE,
    useFactory: (prisma: PrismaClient, tracker: JobTracker): JobQueue<IngestJob> =>
      createQueue<IngestJob>('decant-ingest', makeHandler(prisma, tracker), { redisUrl: process.env.REDIS_URL }),
    inject: [PRISMA, JOB_TRACKER],
  },
];
