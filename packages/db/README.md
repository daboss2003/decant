# @decant/db
> Prisma persistence, the sole human-write path, and the runtime calibration loader.

**What it's for** — The shared runtime-IO package every adapter depends on. It owns Decant's data model (`schema.prisma`), the transactional write of a pipeline run, and `PrismaReviewService` — the one place a human correction is recorded (always with an audit event). It also hosts `loadCalibration()`, the runtime calibrator loader, because [`@decant/core`](../core) is node-free (no `fs`) and [`@decant/eval`](../eval) is offline-only tooling that production code must never import.

## Public API
- `createPrismaClient(databaseUrl?)` — make a `PrismaClient`, optionally overriding the datasource URL (tests pass a temp DB).
- `savePipelineResult(prisma, { sourceType, nPages, result, imageRef?, pageImageRefs? })` — persist Upload → Documents → Fields + audit events in one `$transaction`; returns the new upload id.
- `PrismaReviewService` (implements `ReviewService`) — `.applyCorrection(input)`: the sole human-write path; `accept` writes a `Correction` + updates the `Field` + audits it, `decline`/`cancel` records the non-action and leaves `needs_review`.
- `loadCalibration()` — load the offline-fitted calibrator; returns `Calibration | CalibrationSet | undefined` (always optional, never fatal).
- `toJson(v)` — coerce any JS value to a Prisma Json input (JS `null`/`undefined` → JSON null).
- Re-exports `Prisma` and `PrismaClient` from `@prisma/client`.

## Commands (package.json scripts)
- `db:generate` — `prisma generate` (regenerate the client; run after any schema or provider change).
- `db:push` — `prisma db push` (sync the schema to `DATABASE_URL`; creates the dev SQLite file).
- `use-sqlite` / `use-postgres` — rewrite the `datasource` provider in `schema.prisma` to `sqlite` (dev/tests) or `postgresql` (prod), then re-run `db:generate`.

## How it's used
Wiring in an adapter (see [`apps/web/lib/db.ts`](../../apps/web/lib/db.ts)):
```ts
import { createPrismaClient, PrismaReviewService } from '@decant/db';

const prisma = createPrismaClient(process.env.DATABASE_URL);
const reviewService = new PrismaReviewService(prisma);

// after a run (apps/cli/src/wiring.ts):
const uploadId = await savePipelineResult(prisma, { sourceType: 'photo', nPages, result });
```
Env vars:
- `DATABASE_URL` — Prisma datasource URL (e.g. `file:./prisma/dev.db` for SQLite, a Postgres URL for prod).
- `DECANT_CALIBRATION` — explicit path to `calibration.json` (overrides the default `../../reports/eval/calibration.json` relative to cwd).

## Depends on
- [`@decant/core`](../core) — types only (`PipelineResult`, `ReviewService`, `CorrectionInput`, `Calibration`, `CalibrationSet`).
- `@prisma/client` / `prisma` — the ORM and CLI.

## Notes
- Prisma's `provider` must be a static literal, so `use-sqlite` / `use-postgres` rewrite `schema.prisma` in place — commit the switch, and always `db:generate` afterward.
- `applyCorrection` coerces a human string back to the field's stored type (numeric stays numeric) *before* the transaction, so bad input fails fast with no partial write.
- Json columns (`signals`, `provenance`, `payload`, `enrichment`) keep every raw run detail so calibration can be re-fit offline.
- `loadCalibration()` resolves `../../reports/eval/calibration.json` relative to cwd — correct for adapters run from `apps/<name>` (two levels down).

Tests: `packages/db/test/` — run `pnpm test` from the repo root.
