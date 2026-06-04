import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DocumentResult, FxEnrichment, VerificationEnrichment } from '@decant/core';
import { ExternalMcpClient } from './mcp-client';
import { FxEnricher } from './enrichers';
import { registryVerifier, mcpRegistryLookup } from './verifiers/registry';
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

const verify = (client: ExternalMcpClient, doc: DocumentResult) =>
  registryVerifier(mcpRegistryLookup(client)).enrich(doc) as Promise<VerificationEnrichment[]>;

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

describe('registryVerifier (a Verifier over the registry MCP server)', () => {
  it('verifies a matching company name', async () => {
    const [e] = await verify(registryClient, cacDoc('Acme Nigeria Ltd'));
    expect(e.status).toBe('verified');
    expect(e.verifier).toBe('registry');
    expect(e.field).toBe('companyName');
    expect(e.authoritativeValue).toBe('Acme Nigeria Limited');
  });

  it('flags a mismatched company name', async () => {
    const [e] = await verify(registryClient, cacDoc('Zenith Holdings'));
    expect(e.status).toBe('mismatch');
  });

  it('reports not_found for an unknown RC number', async () => {
    const [e] = await verify(registryClient, cacDoc('Acme', 'RC999999'));
    expect(e.status).toBe('not_found');
  });

  it('marks a name-matching but INACTIVE company as inactive (safe failure, not verified)', async () => {
    const [e] = await verify(registryClient, cacDoc('Initech Systems Ltd', 'RC222333'));
    expect(e.status).toBe('inactive');
    expect(e.source).toBe('demo');
  });

  it('records unavailable (not a silent skip) when the registry server cannot be reached', async () => {
    const dead = new ExternalMcpClient({ command: tsx, args: [resolve(here, 'does-not-exist.ts')] }, { connectTimeoutMs: 4000 });
    try {
      const [e] = await verify(dead, cacDoc('Acme'));
      expect(e.status).toBe('unavailable');
    } finally {
      await dead.close();
    }
  }, 20_000);
});

describe('EnrichmentService (routes enrichers + folds results into the trust loop)', () => {
  const service = () => new EnrichmentService([new FxEnricher(fxClient, 'USD', ['total']), registryVerifier(mcpRegistryLookup(registryClient))]);

  it('FX-enriches a receipt and leaves fields untouched', async () => {
    const out = await service().enrich(receiptDoc);
    expect(out.enrichments?.some((e) => e.kind === 'fx')).toBe(true);
    expect(out.enrichments?.some((e) => e.kind === 'verification')).toBe(false); // no rcNumber
  });

  it('a registry mismatch routes companyName to review (safe failure via an external source)', async () => {
    const out = await service().enrich(cacDoc('Zenith Holdings'));
    const name = out.fields.find((f) => f.fieldPath === 'companyName');
    expect(name?.status).toBe('needs_review');
    expect(name?.signals.registryMismatch).toBe(true);
  });
});
