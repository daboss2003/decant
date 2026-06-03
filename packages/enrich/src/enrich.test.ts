import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DocumentResult, FxEnrichment, RegistryEnrichment } from '@decant/core';
import { ExternalMcpClient } from './mcp-client';
import { FxEnricher, RegistryEnricher } from './enrichers';
import { EnrichmentService } from './enrichment.service';
import { FX_DEMO_SERVER, REGISTRY_DEMO_SERVER } from './index';

const here = dirname(fileURLToPath(import.meta.url));
const tsx = resolve(here, '../node_modules/.bin/tsx');

let fxClient: ExternalMcpClient;
let registryClient: ExternalMcpClient;

beforeAll(async () => {
  // No env forwarded — the SDK's default allowlist supplies PATH for tsx.
  fxClient = new ExternalMcpClient({ command: tsx, args: [FX_DEMO_SERVER] });
  registryClient = new ExternalMcpClient({ command: tsx, args: [REGISTRY_DEMO_SERVER] });
  await Promise.all([fxClient.connect(), registryClient.connect()]);
}, 60_000);

afterAll(async () => {
  await Promise.all([fxClient?.close(), registryClient?.close()]);
});

const field = (fieldPath: string, value: unknown) => ({ fieldPath, value, confidence: 0.95, status: 'auto_approved' as const, signals: {} });

const receiptDoc: DocumentResult = {
  documentId: 'r',
  docType: 'receipt',
  mode: 'typed',
  pageRange: [0, 0],
  reclassify: false,
  ruleResults: [],
  fields: [field('currency', 'NGN'), field('total', 1075), field('transactionDate', '2026-05-01')],
};

const cacDoc = (companyName: string, rcNumber = 'RC123456'): DocumentResult => ({
  documentId: 'c',
  docType: 'cac',
  mode: 'typed',
  pageRange: [0, 0],
  reclassify: false,
  ruleResults: [],
  fields: [field('rcNumber', rcNumber), field('companyName', companyName)],
});

describe('FxEnricher (consumes the FX MCP server)', () => {
  it('converts a money field into the base currency', async () => {
    const [e] = (await new FxEnricher(fxClient, 'USD', ['total']).enrich(receiptDoc)) as FxEnrichment[];
    expect(e.kind).toBe('fx');
    expect(e.currency).toBe('NGN');
    expect(e.base).toBe('USD');
    expect(e.rate).toBeCloseTo(0.00065, 6);
    expect(e.baseAmount).toBeCloseTo(0.7, 2); // 1075 * 0.00065 = 0.69875 -> 0.70
  });
});

describe('RegistryEnricher (consumes the registry MCP server)', () => {
  it('verifies a matching company name', async () => {
    const [e] = (await new RegistryEnricher(registryClient).enrich(cacDoc('Acme Nigeria Ltd'))) as RegistryEnrichment[];
    expect(e.status).toBe('verified');
    expect(e.registeredName).toBe('Acme Nigeria Limited');
  });

  it('flags a mismatched company name', async () => {
    const [e] = (await new RegistryEnricher(registryClient).enrich(cacDoc('Zenith Holdings'))) as RegistryEnrichment[];
    expect(e.status).toBe('mismatch');
  });

  it('reports not_found for an unknown RC number', async () => {
    const [e] = (await new RegistryEnricher(registryClient).enrich(cacDoc('Acme', 'RC999999'))) as RegistryEnrichment[];
    expect(e.status).toBe('not_found');
  });

  it('records unavailable (not a silent skip) when the registry server cannot be reached', async () => {
    const dead = new ExternalMcpClient({ command: tsx, args: [resolve(here, 'does-not-exist.ts')] }, { connectTimeoutMs: 4000 });
    try {
      const [e] = (await new RegistryEnricher(dead).enrich(cacDoc('Acme'))) as RegistryEnrichment[];
      expect(e.status).toBe('unavailable');
    } finally {
      await dead.close();
    }
  }, 20_000);
});

describe('EnrichmentService (routes enrichers + folds results into the trust loop)', () => {
  const service = () => new EnrichmentService([new FxEnricher(fxClient, 'USD', ['total']), new RegistryEnricher(registryClient)]);

  it('FX-enriches a receipt and leaves fields untouched', async () => {
    const out = await service().enrich(receiptDoc);
    expect(out.enrichments?.some((e) => e.kind === 'fx')).toBe(true);
    expect(out.enrichments?.some((e) => e.kind === 'registry')).toBe(false); // no rcNumber
  });

  it('a registry mismatch routes companyName to review (safe failure via an external source)', async () => {
    const out = await service().enrich(cacDoc('Zenith Holdings'));
    const name = out.fields.find((f) => f.fieldPath === 'companyName');
    expect(name?.status).toBe('needs_review');
    expect(name?.signals.registryMismatch).toBe(true);
  });
});
