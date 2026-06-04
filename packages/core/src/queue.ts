/**
 * The async-pipeline seam (plan §8 / "BullMQ + Redis"). Producers `add` jobs; a
 * registered handler processes them. Two implementations share this contract:
 *   - InProcessQueue (the dev default; no Redis) — runs the handler inline;
 *   - BullmqQueue (@decant/queue) — durable Redis-backed jobs with concurrency,
 *     retries/backoff, and forked workers, activated by REDIS_URL.
 * The pipeline/handler code is identical either way (one core, swappable infra).
 */
export type JobHandler<T> = (data: T) => Promise<void>;

export interface JobQueue<T> {
  /** Submit a job for processing by the registered handler. */
  add(data: T): Promise<void>;
  close(): Promise<void>;
}

/** Runs jobs in-process (the default — preserves today's synchronous behavior). */
export class InProcessQueue<T> implements JobQueue<T> {
  constructor(private readonly handler: JobHandler<T>) {}
  async add(data: T): Promise<void> {
    await this.handler(data);
  }
  async close(): Promise<void> {
    /* nothing to tear down */
  }
}

/**
 * One upload to push through the pipeline — the unit of async work. Serializable
 * (paths + text, not objects) so it survives a BullMQ round-trip to a worker.
 */
export interface IngestJob {
  /** Correlation id for status polling. */
  jobId: string;
  sourceType: string;
  /** Per-page image paths (rasterized PDF pages / images). */
  pageImages: string[];
  /** Per-page born-digital text ('' where none). */
  pageTexts: string[];
}
