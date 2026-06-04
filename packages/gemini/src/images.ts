/**
 * Page-image access for the Gemini services. Abstracted so core/test code stays
 * free of fs/S3 — the app supplies a real (fs/S3-backed) implementation; tests
 * and demos use the in-memory one.
 */
export interface LoadedImage {
  mimeType: string;
  /** base64-encoded image bytes (for Gemini `inlineData`). */
  dataBase64: string;
}

export interface PageImageStore {
  /** Load a single page by its stored ref (used by classify — pages carry refs). */
  loadByRef(ref: string): Promise<LoadedImage>;
  /** Load a document's pages by upload id + page indices (used by extraction). */
  loadByUpload(uploadId: string, pageIndices: number[]): Promise<LoadedImage[]>;
  /**
   * Optional: the born-digital TEXT layer for the given pages ('' where a page has
   * none, e.g. a scanned/image page). When present, extraction reads the exact text
   * instead of sending an image to the vision model (cheaper + no OCR error).
   */
  loadText?(uploadId: string, pageIndices: number[]): Promise<string[]>;
}

export class InMemoryPageImageStore implements PageImageStore {
  constructor(
    private readonly byRef: Map<string, LoadedImage> = new Map(),
    private readonly byUpload: Map<string, LoadedImage[]> = new Map(),
    private readonly byUploadText: Map<string, string[]> = new Map(),
  ) {}

  async loadByRef(ref: string): Promise<LoadedImage> {
    const img = this.byRef.get(ref);
    if (!img) throw new Error(`InMemoryPageImageStore: no image for ref "${ref}"`);
    return img;
  }

  async loadByUpload(uploadId: string, _pageIndices: number[]): Promise<LoadedImage[]> {
    return this.byUpload.get(uploadId) ?? [];
  }

  async loadText(uploadId: string, pageIndices: number[]): Promise<string[]> {
    const t = this.byUploadText.get(uploadId) ?? [];
    return pageIndices.map((i) => t[i] ?? '');
  }
}
