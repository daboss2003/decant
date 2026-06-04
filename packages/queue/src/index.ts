import { InProcessQueue, type JobHandler, type JobQueue } from '@decant/core';
import { BullmqQueue, type BullmqOptions } from './bullmq-queue';

export * from './bullmq-queue';

export interface CreateQueueOptions extends BullmqOptions {
  /** Redis connection string; falls back to process.env.REDIS_URL. */
  redisUrl?: string;
}

/**
 * Pick the queue implementation by environment: a Redis-backed BullMQ queue when
 * a REDIS_URL is configured, else the in-process queue (the dev default). Lets the
 * same code run with durable async jobs in prod and inline in dev/tests.
 */
export function createQueue<T>(name: string, handler: JobHandler<T>, opts: CreateQueueOptions = {}): JobQueue<T> {
  const redisUrl = opts.redisUrl ?? process.env.REDIS_URL;
  return redisUrl ? new BullmqQueue<T>(name, handler, redisUrl, opts) : new InProcessQueue<T>(handler);
}
