import { describe, it, expect } from 'vitest';
import { GeminiExtractionService } from '../src/extraction.service';
import { InMemoryPageImageStore, type LoadedImage } from '../src/images';
import type { GeminiClient, GeminiJsonRequest } from '../src/client';
import { registry, type DocumentSegment } from '@decant/core';

class FakeClient implements GeminiClient {
  requests: GeminiJsonRequest[] = [];
  constructor(private readonly next: string | undefined) {}
  async generateJson(req: GeminiJsonRequest): Promise<string | undefined> {
    this.requests.push(req);
    return this.next;
  }
}

const img: LoadedImage = { mimeType: 'image/png', dataBase64: 'AAA' };
const store = new InMemoryPageImageStore(new Map(), new Map([['u1', [img]]]));

const ef = (v: unknown) => ({ value: v, modelConfidence: 0.9, sourceQuote: v === null ? null : String(v) });
const receiptJson = JSON.stringify({
  merchantName: ef('Cafe'),
  merchantTaxId: ef(null),
  transactionDate: ef('2026-05-01'),
  currency: ef('NGN'),
  lineItems: [{ description: ef('Tea'), qty: ef(1), unitPrice: ef(500), lineTotal: ef(500) }],
  subtotal: ef(500),
  tax: ef(0),
  tip: ef(0),
  discount: ef(0),
  total: ef(500),
  paymentMethod: ef('cash'),
});

const typedSeg: DocumentSegment = { docType: 'receipt', pageRange: [0, 0], confidence: 1, isGeneric: false };
const genericSeg: DocumentSegment = { docType: 'unknown', pageRange: [1, 1], confidence: 0.3, isGeneric: true };

describe('GeminiExtractionService', () => {
  it('extracts a registered type with that type schema (Flash, no type:null)', async () => {
    const client = new FakeClient(receiptJson);
    const svc = new GeminiExtractionService(client, store, registry);
    const doc = await svc.extract(typedSeg, 'u1');
    expect(doc.mode).toBe('typed');
    expect(doc.docType).toBe('receipt');
    expect((doc.raw as { total: { value: number } }).total.value).toBe(500);
    expect(client.requests[0]?.model).toBe('gemini-2.5-flash');
    expect(JSON.stringify(client.requests[0]?.responseJsonSchema)).not.toContain('"type":"null"');
  });

  it('uses the generic schema for an unregistered segment', async () => {
    const client = new FakeClient(
      JSON.stringify({ type: 'rent_receipt', fields: [{ name: 'landlord', value: 'A', modelConfidence: 0.8, sourceQuote: 'A' }] }),
    );
    const svc = new GeminiExtractionService(client, store, registry);
    const doc = await svc.extract(genericSeg, 'u1');
    expect(doc.mode).toBe('generic');
    expect((doc.raw as { fields: Array<{ name: string }> }).fields[0]?.name).toBe('landlord');
  });

  it('is fail-safe on empty/garbage model output (no throw)', async () => {
    const client = new FakeClient(undefined);
    const svc = new GeminiExtractionService(client, store, registry);
    const doc = await svc.extract(typedSeg, 'u1');
    expect(doc.mode).toBe('typed');
    expect(doc.raw).toEqual({}); // parseJsonSafe -> null -> {}
  });

  it('reads the born-digital TEXT layer when present (no image sent to the model)', async () => {
    const bornDigital = 'CAFE NEABLE  Date: 2026-05-01  Subtotal 500  VAT 0  TOTAL 500  Currency NGN';
    const textStore = new InMemoryPageImageStore(new Map(), new Map([['u1', [img]]]), new Map([['u1', [bornDigital]]]));
    const client = new FakeClient(receiptJson);
    const svc = new GeminiExtractionService(client, textStore, registry);
    const doc = await svc.extract(typedSeg, 'u1');
    expect(doc.mode).toBe('typed');
    expect(client.requests[0]?.images).toHaveLength(0); // text path → no vision
    expect(client.requests[0]?.userText).toContain('CAFE NEABLE'); // exact text fed to the model
  });

  it('falls back to the image when there is no (or too little) text layer', async () => {
    const scanned = new InMemoryPageImageStore(new Map(), new Map([['u1', [img]]]), new Map([['u1', ['']]]));
    const client = new FakeClient(receiptJson);
    const svc = new GeminiExtractionService(client, scanned, registry);
    await svc.extract(typedSeg, 'u1');
    expect(client.requests[0]?.images).toHaveLength(1); // vision path
  });
});
