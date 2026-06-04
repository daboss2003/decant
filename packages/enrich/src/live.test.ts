import { describe, it, expect, afterAll } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DocumentResult, FxEnrichment, VerificationEnrichment } from '@decant/core';
import { ExternalMcpClient } from './mcp-client';
import { FxEnricher } from './enrichers';
import { registryVerifier, mcpRegistryLookup } from './verifiers/registry';
import { FX_LIVE_SERVER, REGISTRY_GLEIF_SERVER } from './index';

/**
 * Opportunistic coverage for the REAL external adapters (open.er-api FX, GLEIF
 * registry). Network-gated: if the sources are unreachable (offline/CI), the
 * suite skips rather than failing.
 */
async function canReach(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}
const online = await canReach('https://open.er-api.com/v6/latest/USD');

const here = dirname(fileURLToPath(import.meta.url));
const tsx = resolve(here, '../node_modules/.bin/tsx');
const clientOpts = { connectTimeoutMs: 8000, callTimeoutMs: 15000 };

const f = (fieldPath: string, value: unknown) => ({ fieldPath, value, confidence: 0.9, status: 'auto_approved' as const, signals: {} });
const receiptDoc: DocumentResult = {
  documentId: 'r', docType: 'receipt', mode: 'typed', pageRange: [0, 0], reclassify: false, ruleResults: [],
  fields: [f('currency', 'NGN'), f('total', 5000)],
};
const cacDoc = (name: string): DocumentResult => ({
  documentId: 'c', docType: 'cac', mode: 'typed', pageRange: [0, 0], reclassify: false, ruleResults: [],
  fields: [f('rcNumber', 'RC123456'), f('companyName', name)],
});

const clients: ExternalMcpClient[] = [];
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
});

describe.skipIf(!online)('live external adapters (network)', () => {
  it('FX: open.er-api converts NGN→USD at a real rate', async () => {
    const c = new ExternalMcpClient({ command: tsx, args: [FX_LIVE_SERVER] }, clientOpts);
    clients.push(c);
    const [e] = (await new FxEnricher(c, 'USD', ['total']).enrich(receiptDoc)) as FxEnrichment[];
    expect(e.rate).toBeGreaterThan(0);
    expect(e.rate).toBeLessThan(1); // 1 NGN is a small fraction of a USD
    expect(e.baseAmount).toBeGreaterThan(0);
    expect(e.asOf).toBeTruthy();
  }, 30_000);

  it('Registry: GLEIF verifies a real entity and not_founds a fake one', async () => {
    const c = new ExternalMcpClient({ command: tsx, args: [REGISTRY_GLEIF_SERVER] }, clientOpts);
    clients.push(c);
    const [real] = (await registryVerifier(mcpRegistryLookup(c)).enrich(cacDoc('Apple Inc.'))) as VerificationEnrichment[];
    expect(real.status).toBe('verified');
    expect(real.authoritativeValue).toBeTruthy();
    expect(real.reference).toBeTruthy(); // anchored to a real LEI

    const [fake] = (await registryVerifier(mcpRegistryLookup(c)).enrich(cacDoc('Zzqx Nonexistent Holdings 99999 Ltd'))) as VerificationEnrichment[];
    expect(fake.status).toBe('not_found');
  }, 30_000);
});
