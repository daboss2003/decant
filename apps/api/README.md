# @decant/api

> NestJS REST adapter exposing Decant's results, review queue, and async ingest.

**What it's for** — A thin HTTP layer over the SAME [`@decant/core`](../../packages/core) domain logic and [`@decant/db`](../../packages/db) persistence that the CLI, web, and MCP adapters use — no extraction, validation, or review logic is re-implemented here. It serves document results + the human review queue, accepts human corrections (writing the identical `Correction` + `AuditEvent`), and runs an async upload→ingest→pipeline→persist flow. It's the browser-reachable backend for the Next.js review UI.

## Endpoints

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness: `{ ok: true, service: 'decant-api' }`. |
| `GET` | `/review-queue` | Documents with `needs_review` fields + their flagged field paths. |
| `GET` | `/documents/:id` | One document with its fields + upload. |
| `GET` | `/documents/:id/audit` | The document's `AuditEvent` log, oldest first. |
| `POST` | `/documents/:id/corrections` | Apply a human correction (`accept` / `decline` / `cancel`). |
| `POST` | `/uploads` | Multipart ingest (`files` field, ≤20 files, ≤20 MB each) → returns a `jobId`. |
| `GET` | `/uploads/:jobId` | Poll job status: `queued` / `processing` / `done` / `error`. |

## Commands

- `pnpm start` — `tsx src/main.ts`; boots Nest, binds `HOST:PORT`, logs `API_LISTENING <port>`.

## How it's used

```bash
# From apps/api
DECANT_PIPELINE_MODE=echo pnpm start          # offline dry-run (no model calls)

# Async ingest, then poll
curl -F files=@invoice.pdf http://127.0.0.1:3001/uploads
# → {"jobId":"…","status":"queued"}
curl http://127.0.0.1:3001/uploads/<jobId>     # → {"jobId":"…","status":"done","uploadId":"…","documentId":"…"}

# Apply a correction (bearer header only needed when API_AUTH_TOKEN is set)
curl -X POST http://127.0.0.1:3001/documents/<id>/corrections \
  -H 'content-type: application/json' \
  -d '{"fieldPath":"total","action":"accept"}'
```

Env vars:
- `PORT` / `HOST` — bind address (default `3001` / `127.0.0.1`; `PORT=0` → ephemeral, used by tests).
- `DATABASE_URL` — Prisma connection; defaults to the repo's `packages/db/prisma/dev.db`.
- `REDIS_URL` — if set, ingest runs through BullMQ; otherwise an in-process queue.
- `RATE_LIMIT_RPM` — per-IP requests/minute (default `120`; `0` disables).
- `TRUST_PROXY` — `1` to read the client IP from proxy headers.
- `UPLOADS_DIR` — where page images are persisted (defaults to the web app's `public/uploads`).
- `API_AUTH_TOKEN` — if set, every request needs `Authorization: Bearer <token>`.
- `DECANT_PIPELINE_MODE=echo` — skip the model; persist ingested text as a generic doc.
- `GEMINI_API_KEY` — required for the real pipeline (unset is fine in `echo` mode).

## Depends on

- [`@decant/core`](../../packages/core) — `DocumentPipeline`, validation/confidence/routing services, `JobQueue`/`IngestJob` types.
- [`@decant/db`](../../packages/db) — `createPrismaClient`, `PrismaReviewService`, `savePipelineResult`, `loadCalibration`.
- [`@decant/gemini`](../../packages/gemini) — `GoogleGenAIClient`, classify + extraction services for the real pipeline.
- [`@decant/ingest`](../../packages/ingest) — `toPages` (multi-format → pages), `FsPageImageStore`, `persistPageImages`.
- [`@decant/queue`](../../packages/queue) — `createQueue` (in-process or BullMQ).
- `@nestjs/*` + `multer` — HTTP transport + multipart upload handling.

## Notes

- **Explicit-token DI.** Providers are injected via `@Inject(SYMBOL)` (e.g. `PRISMA`, `REVIEW`, `INGEST_QUEUE`, `JOB_TRACKER`), never by type — the app runs under tsx/esbuild with no `emitDecoratorMetadata`.
- **Two global guards** (`main.ts`): `RateLimitGuard` always on; `BearerGuard` is a no-op unless `API_AUTH_TOKEN` is set. The API is intentionally open by default; rate-limiting is the abuse guard.
- **Single-host design.** Job status lives in an in-memory `JobTracker` map and rate-limit state is per-process; horizontal scaling would need a shared (Redis/Postgres) store.
- The calibrator is loaded once at boot via `loadCalibration()`, so uploads route on calibrated probabilities (absent → raw scores). Temp upload/raster dirs are cleaned up only on success (kept for BullMQ retries).

Tests: `apps/api/test/` — run `pnpm test` from the repo root.
