# @decant/cli
> Command-line adapter that drives the real Decant pipeline over local documents.

**What it's for** — The CLI is the thinnest, most direct adapter onto [`@decant/core`](../../packages/core): point it at a file (image/PDF/text/HTML/CSV/…) and it runs the full classify → extract → validate → confidence → route pipeline, prints per-field auto-approve/review decisions, and can persist the result into the dev review queue. It also hosts the offline **eval** harness (run the pipeline over a gold set, emit `results.json` for the calibration sidecar) and a tiny synthetic-receipt generator. It exists so the domain core can be exercised end-to-end without standing up the REST API or web UI.

## Commands
All scripts are `tsx`-run (no build). Run from `apps/cli/`.

- `pnpm extract <file…> [flags]` (`src/run.ts`) — run the pipeline over one or more files; prints decisions.
  - `--save` persist to the dev review queue + copy page images into the web app; prints the review URL.
  - `--ocr` attach Tesseract OCR provenance (heavy; off by default).
  - `--enrich` / `--enrich-live` MCP-client enrichment (FX + registry) via spawned demo or live servers.
  - `--samples N` N-sample self-consistency extraction (uses temperature > 0).
- `pnpm eval [flags]` (`src/eval.ts`) — score the pipeline against a gold set → `reports/eval/results.json`.
  - `--gold-dir <dir>` score real redacted `<name>.<ext>` + `<name>.gold.json` pairs (see [`gold-samples/`](./gold-samples)).
  - `--type <docType>` / `--limit N` filter the set · `--render-only [dir]` render synthetic images only, no Gemini.
- `pnpm gen-sample [outPath] [totalText]` (`src/gen-sample.ts`) — emit a synthetic receipt PNG (pass a non-reconciling total to demo safe-failure).

## How it's used
```bash
# extract + review-queue a receipt (needs GEMINI_API_KEY)
pnpm gen-sample sample-receipt.png
pnpm extract sample-receipt.png --save --enrich

# fit the calibrator from a fresh eval run
pnpm eval --receipts 24 --bank 12 --cac 12
# → reports/eval/results.json, then: python -m calibrate.fit --in … --out reports/eval/
```
`src/wiring.ts` is the assembly point: `buildPipeline()` composes the Gemini classify/extract services, rule validation, `HeuristicConfidenceService` (fed `loadCalibration()`, re-exported from [`@decant/db`](../../packages/db)), and threshold routing; `buildEnrichment()` spawns the MCP FX/registry servers; `saveToReviewQueue()` writes via `savePipelineResult` + copies page images for the web UI.

**Env vars**
- `GEMINI_API_KEY` — required for `extract` and `eval`; loaded from env, `.env`, or `packages/gemini/.env`.

## Depends on
- [`@decant/core`](../../packages/core) — `DocumentPipeline` + service classes assembled in `wiring.ts`.
- [`@decant/gemini`](../../packages/gemini) — classify/extract services; [`@decant/ingest`](../../packages/ingest) — `toPages` + `FsPageImageStore`.
- [`@decant/db`](../../packages/db) — `loadCalibration`, `createPrismaClient`, `savePipelineResult`.
- [`@decant/enrich`](../../packages/enrich) — MCP-client enrichment; [`@decant/ocr`](../../packages/ocr) — Tesseract provider.
- [`@decant/eval`](../../packages/eval) — offline gold-set + scoring (used only by `eval`); [`@decant/schemas`](../../packages/schemas) — shared types.

## Notes
- No build step: scripts run source directly via `tsx`. Import siblings as `@decant/<name>`.
- `--save` and `eval` write paths are resolved **relative to `apps/cli/`** (`../../packages/db/prisma/dev.db`, `../../reports/eval/`); run scripts from the package dir.
- The `extract` pipeline applies calibrated probabilities; the `eval` pipeline deliberately omits calibration so it measures RAW scores to fit the calibrator.
- `buildEnrichment` never forwards `process.env` to spawned servers, so `GEMINI_API_KEY` is not leaked to child processes.

Tests: `apps/cli/test/` — run `pnpm test` from the repo root.
