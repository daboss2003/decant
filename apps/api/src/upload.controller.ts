import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BadRequestException, Controller, Get, Inject, NotFoundException, Param, Post, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { toPages } from '@decant/ingest';
import type { IngestJob, JobQueue } from '@decant/core';
import { INGEST_QUEUE, JOB_TRACKER, type JobTracker } from './ingest.providers';

/** Minimal shape we use from a multer file (avoids depending on Express types here). */
interface UploadFile {
  originalname: string;
  buffer: Buffer;
}

/** Keep only a safe basename + extension for the temp file. */
const safeName = (name: string, i: number): string => `${i}-${basename(name).replace(/[^a-zA-Z0-9._-]/g, '_')}${extname(name) ? '' : '.bin'}`;

/**
 * Async ingest endpoint (plan §8). Accepts uploaded documents (image / PDF / text
 * formats), ingests them through the shared multi-format path, and enqueues a job
 * (in-process, or BullMQ when REDIS_URL is set). Returns a jobId to poll.
 */
@Controller('uploads')
export class UploadController {
  constructor(
    @Inject(INGEST_QUEUE) private readonly queue: JobQueue<IngestJob>,
    @Inject(JOB_TRACKER) private readonly tracker: JobTracker,
  ) {}

  @Post()
  // Cap file size + count so a single request can't buffer unbounded bytes in
  // memory (multer's default memory storage); oversize → multer 413 via Nest.
  @UseInterceptors(FilesInterceptor('files', 20, { limits: { fileSize: 20 * 1024 * 1024, files: 20 } }))
  async upload(@UploadedFiles() files: UploadFile[]): Promise<{ jobId: string; status: string }> {
    if (!files?.length) throw new BadRequestException('expected one or more files in the "files" field');
    const dir = mkdtempSync(join(tmpdir(), 'decant-upload-'));
    const paths = files.map((f, i) => {
      const p = join(dir, safeName(f.originalname, i));
      writeFileSync(p, f.buffer);
      return p;
    });

    const { images, texts, tempDirs } = await toPages(paths);
    const jobId = randomUUID();
    this.tracker.set(jobId, { status: 'queued' });
    // The upload dir + any PDF-rasterization dirs are temp; the handler deletes them when done.
    await this.queue.add({ jobId, sourceType: 'upload', pageImages: images, pageTexts: texts, tempDirs: [dir, ...tempDirs] });

    return { jobId, status: this.tracker.get(jobId)?.status ?? 'queued' };
  }

  @Get(':jobId')
  status(@Param('jobId') jobId: string): { jobId: string } & JobTrackerValue {
    const state = this.tracker.get(jobId);
    if (!state) throw new NotFoundException(`No job ${jobId}`);
    return { jobId, ...state };
  }
}

type JobTrackerValue = NonNullable<ReturnType<JobTracker['get']>>;
