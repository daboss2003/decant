# @decant/gemini

> Gemini-backed adapters for Decant's classify + extract service interfaces.

**What it's for** — This is the thin transport adapter that talks to Google's Gemini Developer API on behalf of [`@decant/core`](../core). It implements the core `ClassifyService` and `ExtractionService` interfaces with `@google/genai`, sending JSON-Schema-constrained requests and parsing the responses fail-safe. It deliberately prefers a page's born-digital **text layer** over vision (cheaper, exact, no OCR error), and isolates all retry/quota concerns so the rest of the system never sees a raw 429.

## Public API
- `GoogleGenAIClient` — real `GeminiClient` over `@google/genai`; retry/backoff on per-minute 429 / 500 / 503 / network errors, fast-fail on per-day quota.
- `GeminiClient` / `GeminiJsonRequest` — minimal interface the services depend on (lets tests inject a fake client, no key/network).
- `GeminiQuotaError` — thrown when the **per-day** free-tier quota is exhausted; callers should stop, not retry (`.dailyQuotaExhausted === true`).
- `GeminiClassifyService` — implements core `ClassifyService`: one batched Flash-Lite call → per-page `{ docType, confidence }`.
- `GeminiExtractionService` — implements core `ExtractionService`: typed (registry schema) or generic extraction → `ExtractedDocument`.
- `PageImageStore` / `LoadedImage` — interface for page-image + optional text-layer access; `InMemoryPageImageStore` for tests/demos.
- `classifyPrompt` / `classifyTextPrompt` / `typedExtractPrompt` / `GENERIC_EXTRACT_PROMPT` — prompt builders.

## How it's used
The app supplies the API key and a real `PageImageStore` (e.g. `FsPageImageStore` from [`@decant/ingest`](../ingest)); the services share one client. From `apps/cli/src/wiring.ts`:

```ts
import { GoogleGenAIClient, GeminiClassifyService, GeminiExtractionService } from '@decant/gemini';

const client = new GoogleGenAIClient(apiKey); // throws if apiKey is empty
const classify = new GeminiClassifyService(client, store, { knownTypes: [...KNOWN_DOC_TYPES] });
const extraction = new GeminiExtractionService(client, store, registry); // store: PageImageStore, registry: Registry
```

Env vars:
- `GEMINI_API_KEY` — Gemini Developer API key. The app reads it (e.g. from `packages/gemini/.env`, gitignored) and passes it to `GoogleGenAIClient`; this package itself reads no env (stays node-free).

## Depends on
- [`@decant/core`](../core) — the `ClassifyService` / `ExtractionService` / `Registry` interfaces these classes implement, plus `toGeminiSchema` (Zod→Gemini-dialect JSON Schema).
- [`@decant/schemas`](../schemas) — `ClassifyOutput`, `GenericExtraction`, and the page/field shapes used to build response schemas.
- `@google/genai` — the official Gemini SDK (the single typed boundary lives in `GoogleGenAIClient.generateJson`).

## Notes
- **Text-first.** Both services use the text path only when EVERY page in the batch/segment has ≥12 chars of text; a mixed (partly scanned) PDF falls back to vision so no page is dropped.
- **Lenient parsing, never throw.** Gemini does not enforce JSON-Schema `minimum`/`maximum`, so confidence is clamped to `[0,1]`, not rejected; any parse failure degrades to `unknown`/empty (downstream then routes to review) rather than throwing.
- **Quota vs. rate-limit.** A per-MINUTE 429 is retried with backoff (honoring the server's `retryDelay` hint); a per-DAY 429 throws `GeminiQuotaError` immediately so batch jobs (e.g. eval) can stop early.
- Default models: classify `gemini-2.5-flash-lite`, extraction `gemini-2.5-flash` (override via each service's config).

Tests: `packages/gemini/test/` — run `pnpm test` from the repo root.
