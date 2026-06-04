/**
 * The async-pipeline seam (plan §8 / "BullMQ + Redis"). Producers `add` jobs; a
 * registered handler processes them. Two implementations share this contract:
 *   - InProcessQueue (the dev default; no Redis) — runs the handler inline;
 *   - BullmqQueue (@decant/queue) — durable Redis-backed jobs with concurrency,
 *     retries/backoff, and concurrent in-process workers, activated by REDIS_URL.
 * The pipeline/handler code is identical either way (one core, swappable infra).
 * A handler signals failure by THROWING (BullMQ counts it as a failed attempt and
 * retries); the in-process queue swallows it since the handler records its own
 * status, so a failed job never bubbles up as an enqueue error.
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
    // A throw means "job failed", not "enqueue failed" — the handler records its
    // own status, so don't surface it to the synchronous caller (would 500 the
    // request). BullMQ, by contrast, needs the throw to drive its retries.
    try {
      await this.handler(data);
    } catch {
      /* swallowed: the handler already recorded the failure status */
    }
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
  /**
   * Temp dirs holding the uploaded files / rasterized pages. The handler removes
   * them once the pages are persisted. NB: these are filesystem paths, so a true
   * multi-machine deploy (worker on another host) can't read them — this design
   * assumes the worker shares the API's filesystem (single host / shared volume).
   */
  tempDirs?: string[];
}
