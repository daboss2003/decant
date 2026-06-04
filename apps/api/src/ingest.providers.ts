import {
  DocumentPipeline,
  RuleValidationService,
  HeuristicConfidenceService,
  ThresholdRoutingService,
  registry,
  KNOWN_DOC_TYPES,
  type IngestJob,
  type JobQueue,
  type PipelineResult,
} from '@decant/core';
import { createQueue } from '@decant/queue';
import { GoogleGenAIClient, GeminiClassifyService, GeminiExtractionService } from '@decant/gemini';
import { FsPageImageStore } from '@decant/ingest';
import { savePipelineResult, type PrismaClient } from '@decant/db';
import { PRISMA } from './db.providers';

export const JOB_TRACKER = Symbol('JOB_TRACKER');
export const INGEST_QUEUE = Symbol('INGEST_QUEUE');

export type JobState =
  | { status: 'queued' | 'processing' }
  | { status: 'done'; uploadId: string; documentId: string | null }
  | { status: 'error'; error: string };

/** In-memory job status (single-process; a multi-instance deploy would use Redis/DB). */
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
      confidence: new HeuristicConfidenceService(),
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

/** The job handler: ingest → (pipeline | echo) → persist → record status. Never throws out (best-effort). */
function makeHandler(prisma: PrismaClient, tracker: JobTracker) {
  const echo = process.env.DECANT_PIPELINE_MODE === 'echo';
  return async (job: IngestJob): Promise<void> => {
    tracker.set(job.jobId, { status: 'processing' });
    try {
      const result = echo ? echoResult(job) : await runPipeline(job);
      const uploadId = await savePipelineResult(prisma, { sourceType: job.sourceType, nPages: job.pageImages.length, result });
      const firstDoc = await prisma.document.findFirst({ where: { uploadId }, orderBy: { pageStart: 'asc' } });
      tracker.set(job.jobId, { status: 'done', uploadId, documentId: firstDoc?.id ?? null });
    } catch (e) {
      tracker.set(job.jobId, { status: 'error', error: e instanceof Error ? e.message : String(e) });
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
