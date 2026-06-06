# @decant/web
> Next.js review UI: triage flagged fields, correct them, and upload new documents.

**What it's for** — The human-in-the-loop front end of Decant. It surfaces documents whose
fields the confidence pipeline flagged as low-confidence, lets a reviewer accept a corrected
value or send a field back for review, and shows each field's OCR-aligned provenance overlaid on
the original scan. It is a thin adapter over [@decant/db](../../packages/db) (Prisma) and
[@decant/core](../../packages/core) types; uploads are handed off to the
[REST API](../api). Corrections go through the *same* `PrismaReviewService.applyCorrection`
write path the MCP adapter uses (Correction + AuditEvent in one transaction).

## Routes (App Router)
- `/` — review queue: documents with at least one `needs_review` field.
- `/documents/[id]` — field-by-field review + the multi-page scan viewer with bbox overlays; the
  correction form posts to a server action.
- `/upload` — client page that POSTs files to the REST API and polls `/uploads/:jobId` until done.
- `/login` — password gate (only meaningful when `WEB_PASSWORD` is set).

## Scripts
- `pnpm --filter @decant/web dev` — Next dev server.
- `pnpm --filter @decant/web build` / `start` — production build / serve.
- `pnpm --filter @decant/web seed` — load a demo receipt (with a deliberate total mismatch)
  + page images so the queue is non-empty.

## How it's used
The single human-write path is a server action that validates untrusted `FormData` with zod, then
calls the shared review service (`app/documents/[id]/actions.ts`):

```ts
import { reviewService } from '../../../lib/db'; // = new PrismaReviewService(prisma)

await reviewService.applyCorrection({
  documentId, fieldPath,
  action,                                   // 'accept' | 'decline' | 'cancel' (ReviewAction)
  correctedValue: action === 'accept' ? value : undefined,
  note, actor: 'reviewer',
});
revalidatePath(`/documents/${documentId}`);
```

Env vars:
- `DATABASE_URL` — Prisma connection string. Unset in dev: `lib/db.ts` falls back to the shared
  SQLite file at `packages/db/prisma/dev.db` (resolved relative to cwd = `apps/web`).
- `NEXT_PUBLIC_API_URL` — base URL of the REST API the `/upload` page calls (default
  `http://localhost:3001`).
- `WEB_PASSWORD` — optional. When set, `middleware.ts` requires a session cookie on every page;
  when unset the app is open (dev default).

## Depends on
- [@decant/db](../../packages/db) — `createPrismaClient`, `PrismaReviewService`,
  `savePipelineResult` (queue reads, the correction write path, and the seed script).
- [@decant/core](../../packages/core) — domain types only (`JobState`, `Enrichment`,
  `FieldProvenance`, `PipelineResult`); the app holds no domain logic.
- [@decant/schemas](../../packages/schemas) — `ReviewAction` zod for validating the correction form.
- `next` 16 (App Router) / `react` 19; `sharp` (dev) to rasterize seed scans.

## Notes
- No build step in the monorepo, but **this app does build** (`next build`). `next.config.ts`
  uses `transpilePackages` for the `@decant/*` workspace sources and keeps `@prisma/client` as a
  `serverExternalPackage`.
- Auth is a single-reviewer shared-secret gate, *not* multi-user identity. The cookie stores a
  SHA-256-derived token (`lib/session.ts`), never the raw password; the helper runs in both the
  Edge middleware and the Node server action via Web Crypto.
- `/upload` talks to the **open** (no-auth) REST API directly. If the API runs with
  `API_AUTH_TOKEN` set, browser uploads would 401 — front it with a same-origin route that injects
  the bearer instead.
- bbox coordinates are fractions [0,1] of the page image and rendered as CSS `%` offsets; a field
  appears on the scan only if its `provenance.bbox` is present.
- Before the queue shows anything: `pnpm --filter @decant/db run db:push` then
  `pnpm --filter @decant/web run seed`.

Tests: this app has no `test/` folder — exercise it manually via `pnpm --filter @decant/web dev`.
Run the suite for the rest of the monorepo with `pnpm test` from the repo root.
