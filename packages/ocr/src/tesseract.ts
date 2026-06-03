import sharp from 'sharp';
import { createWorker, type Worker } from 'tesseract.js';
import type { OcrProvider, OcrToken } from '@decant/core';

/**
 * Anything that can hand us the raw bytes of an upload's pages. The Gemini
 * package's `PageImageStore` satisfies this structurally, so the CLI can reuse
 * its existing `FsPageImageStore` here — no new wiring (plan §8: one core, thin
 * adapters).
 */
export interface ImageBytesLoader {
  loadByUpload(uploadId: string, pageIndices: number[]): Promise<Array<{ dataBase64: string }>>;
}

export interface TesseractOptions {
  /** Tesseract language pack(s); defaults to English. */
  lang?: string;
}

/**
 * OCR token source backed by tesseract.js (plan §2/§5). Produces page-relative,
 * normalised word boxes (0..1) that `alignValueToTokens` in @decant/core maps
 * onto each extracted field — giving provenance INDEPENDENT of the model's own
 * claim about where it read a value.
 */
export class TesseractOcrProvider implements OcrProvider {
  private readonly lang: string;

  constructor(
    private readonly loader: ImageBytesLoader,
    opts: TesseractOptions = {},
  ) {
    this.lang = opts.lang ?? 'eng';
  }

  async recognize(uploadId: string, pageIndices: number[]): Promise<OcrToken[]> {
    if (pageIndices.length === 0) return [];
    const images = await this.loader.loadByUpload(uploadId, pageIndices);

    const worker: Worker = await createWorker(this.lang);
    try {
      const tokens: OcrToken[] = [];
      for (let i = 0; i < pageIndices.length; i++) {
        const pageIndex = pageIndices[i]!;
        const image = images[i];
        if (!image) continue;
        const buf = Buffer.from(image.dataBase64, 'base64');
        // tesseract reports pixel boxes; normalise against the true page size.
        const meta = await sharp(buf).metadata();
        const width = meta.width ?? 0;
        const height = meta.height ?? 0;
        if (width === 0 || height === 0) continue;

        const { data } = await worker.recognize(buf, {}, { blocks: true });
        for (const block of data.blocks ?? []) {
          for (const para of block.paragraphs) {
            for (const line of para.lines) {
              for (const word of line.words) {
                const text = word.text.trim();
                if (!text) continue;
                const { x0, y0, x1, y1 } = word.bbox;
                tokens.push({
                  pageIndex,
                  text,
                  bbox: { x: x0 / width, y: y0 / height, w: (x1 - x0) / width, h: (y1 - y0) / height },
                });
              }
            }
          }
        }
      }
      return tokens;
    } finally {
      await worker.terminate();
    }
  }
}
