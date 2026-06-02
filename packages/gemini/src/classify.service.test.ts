import { describe, it, expect } from 'vitest';
import { GeminiClassifyService } from './classify.service';
import { InMemoryPageImageStore, type LoadedImage } from './images';
import type { GeminiClient, GeminiJsonRequest } from './client';

class FakeClient implements GeminiClient {
  requests: GeminiJsonRequest[] = [];
  constructor(private readonly next: string | undefined) {}
  async generateJson(req: GeminiJsonRequest): Promise<string | undefined> {
    this.requests.push(req);
    return this.next;
  }
}

const img: LoadedImage = { mimeType: 'image/png', dataBase64: 'AAA' };
const store = new InMemoryPageImageStore(new Map([['r0', img], ['r1', img]]));
const pages = [
  { pageIndex: 0, imageRef: 'r0' },
  { pageIndex: 1, imageRef: 'r1' },
];

describe('GeminiClassifyService', () => {
  it('parses per-page classification and clamps confidence to [0,1]', async () => {
    const client = new FakeClient(
      JSON.stringify({
        pages: [
          { pageIndex: 0, docType: 'receipt', confidence: 1.5 }, // clamp -> 1
          { pageIndex: 1, docType: 'unknown', confidence: 0.2 },
        ],
      }),
    );
    const svc = new GeminiClassifyService(client, store, { knownTypes: ['receipt'] });
    const out = await svc.classify('u1', pages);
    expect(out.pages).toHaveLength(2);
    expect(out.pages[0]).toEqual({ pageIndex: 0, docType: 'receipt', confidence: 1 });
    expect(out.pages[1]?.confidence).toBeCloseTo(0.2);
  });

  it('uses Flash-Lite, a Gemini-safe schema (no type:null), and sends one image per page', async () => {
    const client = new FakeClient('{"pages":[]}');
    const svc = new GeminiClassifyService(client, store, { knownTypes: ['receipt'] });
    await svc.classify('u1', pages);
    expect(client.requests[0]?.model).toBe('gemini-2.5-flash-lite');
    expect(JSON.stringify(client.requests[0]?.responseJsonSchema)).not.toContain('"type":"null"');
    expect(client.requests[0]?.images).toHaveLength(2);
  });

  it('falls back to all-unknown on unparseable model output (fail-safe)', async () => {
    const client = new FakeClient('not json at all');
    const svc = new GeminiClassifyService(client, store, { knownTypes: ['receipt'] });
    const out = await svc.classify('u1', pages);
    expect(out.pages.every((p) => p.docType === 'unknown' && p.confidence === 0)).toBe(true);
  });
});
