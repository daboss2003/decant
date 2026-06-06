# @decant/ocr
> tesseract.js-backed OCR provider yielding normalized word boxes for provenance.

**What it's for** — A thin adapter implementing [@decant/core](../core)'s `OcrProvider` interface using [tesseract.js](https://github.com/naptha/tesseract.js). It recognizes word-level tokens with bounding boxes normalized to `[0,1]`, which the core pipeline's `alignValueToTokens` maps onto each extracted field. This gives provenance INDEPENDENT of the model's own claim about where it read a value. It is OFF by default — Tesseract is heavy/slow — and only enabled when the caller opts in.

## Public API
- `class TesseractOcrProvider implements OcrProvider` — `recognize(uploadId, pageIndices) → Promise<OcrToken[]>`; runs Tesseract per page and emits normalized word boxes.
- `interface ImageBytesLoader` — `loadByUpload(uploadId, pageIndices) → Promise<{ dataBase64 }[]>`; the byte source. `@decant/gemini`'s `PageImageStore` satisfies it structurally, so the same store feeds both Gemini and OCR.
- `interface TesseractOptions` — `{ lang?: string }`; Tesseract language pack(s), defaults to `'eng'`.

## How it's used
The CLI builds it lazily and passes it as the pipeline's optional `ocr` service (see [apps/cli/src/wiring.ts](../../apps/cli/src/wiring.ts)):

```ts
import { TesseractOcrProvider } from '@decant/ocr';
import { DocumentPipeline } from '@decant/core';

// `store` is a @decant/gemini PageImageStore — structurally an ImageBytesLoader.
const ocr = opts.ocr ? new TesseractOcrProvider(store) : undefined;

new DocumentPipeline({ classify, extraction, validation, confidence, routing, ocr }, config);
```

No env vars. Language packs are fetched/cached by tesseract.js on first `recognize`.

## Depends on
- [@decant/core](../core) — provides the `OcrProvider` interface and `OcrToken` type this package implements/produces.
- `tesseract.js` — the OCR engine (word-level boxes via `recognize(..., { blocks: true })`).
- `sharp` — reads true page pixel dimensions to normalize Tesseract's pixel boxes to `[0,1]`.

## Notes
- Off by default: callers must explicitly construct and inject it; the pipeline runs fine without OCR (provenance just falls back to the model's claim).
- Boxes are page-relative and normalized against `sharp`'s reported page width/height; pages with zero/unknown dimensions are skipped.
- `recognize` spins up one Tesseract `Worker` per call and always `terminate()`s it in a `finally` — no shared worker pool, so it is not optimized for high throughput.
- This package is Node-bound (`sharp`, `Buffer`), unlike the deliberately Node-free [@decant/core](../core).

Tests: no dedicated tests yet — the provenance alignment this provider feeds is covered by [`packages/core/test/provenance.test.ts`](../core/test/provenance.test.ts). Run the suite with `pnpm test` from the repo root.
