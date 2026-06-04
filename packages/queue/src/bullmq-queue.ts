import { Queue, Worker, type ConnectionOptions, type JobsOptions } from 'bullmq';
import type { JobHandler, JobQueue } from '@decant/core';

export interface BullmqOptions {
  /** Worker concurrency (parallel jobs). */
  concurrency?: number;
  /** Retry attempts for a flaky job (e.g. transient Gemini errors). */
  attempts?: number;
  /** Exponential backoff base delay (ms). */
  backoffMs?: number;
}

/**
 * Redis-backed durable job queue (plan §8). One Queue (producer) + one Worker
 * (consumer running the handler) over a shared Redis connection BullMQ owns, with
 * retries + exponential backoff for flaky API calls. Drop-in for InProcessQueue —
 * same JobQueue<T> contract. Requires a reachable Redis (REDIS_URL).
 */
export class BullmqQueue<T> implements JobQueue<T> {
  private readonly queue: Queue;
  private readonly worker: Worker;
  private readonly jobOpts: JobsOptions;

  constructor(name: string, handler: JobHandler<T>, redisUrl: string, opts: BullmqOptions = {}) {
    // Pass connection options (not an ioredis instance) → BullMQ owns the connection.
    const connection: ConnectionOptions = { url: redisUrl, maxRetriesPerRequest: null };
    this.queue = new Queue(name, { connection });
    this.jobOpts = {
      attempts: opts.attempts ?? 3,
      backoff: { type: 'exponential', delay: opts.backoffMs ?? 1_000 },
      removeOnComplete: true,
      removeOnFail: 100,
    };
    this.worker = new Worker(name, async (job) => handler(job.data as T), {
      connection,
      concurrency: opts.concurrency ?? 4,
    });
  }

  async add(data: T): Promise<void> {
    await this.queue.add('job', data, this.jobOpts);
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
  }
}
