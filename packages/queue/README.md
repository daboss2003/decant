# @decant/queue
> Picks a durable Redis queue or the in-process fallback for the ingest pipeline.

**What it's for** — Decant pushes each uploaded document through a multi-step pipeline asynchronously. This package is the infra adapter behind the `JobQueue<T>` seam defined in [@decant/core](../core): it chooses a Redis-backed BullMQ queue when `REDIS_URL` is set, else the core `InProcessQueue`. The same pipeline/handler code runs durably with retries in prod and inline in dev/tests — one core, swappable infra.

## Public API
- `createQueue<T>(name, handler, opts)` — returns a `JobQueue<T>`: `BullmqQueue` when a `REDIS_URL` (or `opts.redisUrl`) is present, otherwise `InProcessQueue`.
- `CreateQueueOptions` — extends `BullmqOptions` with `redisUrl?` (falls back to `process.env.REDIS_URL`).
- `BullmqQueue<T>` — Redis-backed durable `JobQueue<T>`: one producer `Queue` + one consumer `Worker` over a BullMQ-owned connection.
- `BullmqOptions` — `concurrency?` (default 4), `attempts?` (default 3), `backoffMs?` (default 1000, exponential).

The `JobQueue<T>`, `JobHandler<T>`, `InProcessQueue`, and `IngestJob` types come from [@decant/core](../core); they are not re-exported here.

## How it's used
The NestJS API wires the ingest queue in `apps/api/src/ingest.providers.ts`:

```ts
import { createQueue } from '@decant/queue';
import { type IngestJob, type JobQueue } from '@decant/core';

const queue: JobQueue<IngestJob> = createQueue<IngestJob>(
  'decant-ingest',
  makeHandler(prisma, tracker), // async (job) => { ...run pipeline... }
  { redisUrl: process.env.REDIS_URL },
);

await queue.add({ jobId, sourceType: 'pdf', pageImages, pageTexts, tempDirs });
```

Env vars:
- `REDIS_URL` — Redis connection string. Set → durable BullMQ; unset → in-process.

## Depends on
- [@decant/core](../core) — owns the `JobQueue<T>` / `JobHandler<T>` contract, `InProcessQueue`, and the `IngestJob` shape.
- `bullmq` — the Redis-backed durable queue + worker.

## Notes
- Failure contract differs by impl: a handler signals a failed job by **throwing**. BullMQ counts the throw as a failed attempt and retries (with backoff); `InProcessQueue` **swallows** it, since the handler records its own status and `add()` must still resolve so the synchronous upload request doesn't 500.
- `InProcessQueue.add()` runs the handler inline, so it only resolves after the whole pipeline finishes; BullMQ's `add()` returns once the job is enqueued.
- Single-host assumption: `IngestJob.tempDirs` are filesystem paths, so a worker on another machine couldn't read them. This design assumes the worker shares the API's filesystem (single host / shared volume).
- BullMQ is handed connection *options* (`{ url, maxRetriesPerRequest: null }`), not an ioredis instance, so BullMQ owns the connection lifecycle.

Tests: `packages/queue/test/` — run `pnpm test` from the repo root.
