import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { LoadedImage, PageImageStore } from '@decant/gemini';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

const mimeOf = (path: string): string => MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';

/** Node fs-backed PageImageStore — the real-world adapter the pure packages left abstract. */
export class FsPageImageStore implements PageImageStore {
  constructor(
    /** uploadId → ordered absolute page-image paths (page 0, 1, 2, …). */
    private readonly uploads: Map<string, string[]> = new Map(),
    /** uploadId → ordered per-page born-digital text ('' where none). */
    private readonly texts: Map<string, string[]> = new Map(),
  ) {}

  async loadByRef(ref: string): Promise<LoadedImage> {
    const buf = await readFile(ref);
    return { mimeType: mimeOf(ref), dataBase64: buf.toString('base64') };
  }

  async loadByUpload(uploadId: string, pageIndices: number[]): Promise<LoadedImage[]> {
    const paths = this.uploads.get(uploadId) ?? [];
    return Promise.all(
      pageIndices.map((i) => {
        const p = paths[i];
        if (!p) throw new Error(`FsPageImageStore: no page ${i} for upload "${uploadId}"`);
        return this.loadByRef(p);
      }),
    );
  }

  async loadText(uploadId: string, pageIndices: number[]): Promise<string[]> {
    const t = this.texts.get(uploadId) ?? [];
    return pageIndices.map((i) => t[i] ?? '');
  }
}
