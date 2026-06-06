# @decant/ingest

> Turn uploaded files into pipeline-ready per-page images + text.

**What it's for** — The front door of Decant's extraction pipeline: it normalizes whatever a user uploads into aligned per-page images and per-page text. PDFs are rasterized (mupdf) and have their born-digital text layer extracted; born-digital text formats (md/html/xml/svg/txt/csv/…) are read as exact characters with no render; raster images pass through. Downstream classify/extract reads exact text for born-digital pages and only falls back to the vision model for scanned/image pages. Shared by both the CLI and the REST API adapters.

## Public API
- `toPages(paths)` → `{ images, texts, tempDirs }` — the main entry: expands inputs into aligned per-page `images`/`texts`; `tempDirs` are the rasterization dirs this call created (delete after persisting).
- `toPageImages(paths)` — images-only variant (PDFs rasterized, images passed through).
- `rasterizePdf(pdfPath, { scale?, outDir? })` — mupdf rasterize each PDF page to a PNG file (`scale` 2 ≈ 144 DPI); `extractPdfText(pdfPath)` — born-digital text layer per page (no OCR).
- `isPdf(path)` / `isTextFormat(path)` / `loadDocumentText(path)` — format detection + exact text read (markup stripped to text content; returns null for binary).
- `FsPageImageStore` — Node fs-backed `PageImageStore` (from [@decant/gemini](../gemini)) feeding the vision model: `loadByRef` / `loadByUpload` / `loadText` over `uploadId → paths/texts` maps.
- `persistPageImages(pageImagePaths, { dir, urlPrefix, id })` → `{ refs, firstRef }` — content-sniffed sharp→PNG copy into a web-served dir for the review UI (non-raster/text pages yield null).

## How it's used
```ts
import { FsPageImageStore, toPages } from '@decant/ingest';

const uploadId = 'cli-upload';
const { images, texts } = await toPages(files); // files: image | pdf | md | html | … paths
const pages = images.map((f, i) => ({ pageIndex: i, imageRef: f }));
const store = new FsPageImageStore(
  new Map([[uploadId, images]]),
  new Map([[uploadId, texts]]),
);
// store is passed into buildPipeline(...) so the extractor can load page images/text
```
The REST `POST /uploads` handler calls `toPages(paths)` then `persistPageImages(...)`; the CLI `--save` flag does the same (see [apps/cli/src/wiring.ts](../../apps/cli/src/wiring.ts) and [apps/api/src/upload.controller.ts](../../apps/api/src/upload.controller.ts)).

No env vars of its own. (The Gemini key used downstream lives in [@decant/gemini](../gemini)/.env as `GEMINI_API_KEY`.)

## Depends on
- [@decant/gemini](../gemini) — provides the `PageImageStore`/`LoadedImage` interfaces that `FsPageImageStore` implements.
- `mupdf` — WASM PDF rasterize + text-layer extraction (no system deps).
- `sharp` — content-sniffed raster decode → PNG in `persistPageImages` (pixel-capped).

## Notes
- This package uses `node:` builtins (fs/path/os) — it is a runtime adapter, NOT part of the node-free `@decant/core`.
- On the text path `toPages` puts the SOURCE path into `images` (it is the ref, not a loaded image) and the exact text into `texts`; those pages have no scan, so `persistPageImages` returns null for them.
- `toPages` only reports temp dirs it CREATED (one per rasterized PDF) — the caller's own upload dir is not included; clean up `tempDirs` after persisting.
- `persistPageImages` decides raster-vs-skip by CONTENT (sharp decode), not extension, caps decoded pixels (decompression-bomb guard), and isolates each page so one bad page yields null instead of failing the upload.

Tests: `packages/ingest/test/` — run `pnpm test` from the repo root.
