import { describe, it, expect } from 'vitest';
import type { DocumentResult, VerificationEnrichment } from '@decant/core';
import { applyEnrichment } from '@decant/core';
import { makeVerifier } from '../src/verifier';
import { fieldValue } from '../src/enrichers';

const doc = (pairs: Array<[string, unknown]>): DocumentResult => ({
  documentId: 'd', docType: 'bank_statement', mode: 'typed', pageRange: [0, 0], reclassify: false, ruleResults: [],
  fields: pairs.map(([fieldPath, value]) => ({ fieldPath, value, confidence: 0.9, status: 'auto_approved' as const, signals: {} })),
});

/**
 * Demonstrates the whole point of the adapter: to add a NEW verification source a
 * consumer implements ONLY this `lookup` — here a fake bank account-name lookup
 * (a real one would call a NUBAN/bank API). Everything else (compare → verdict →
 * route → audit) is provided by makeVerifier + applyEnrichment.
 */
const BANK: Record<string, { name: string; status: string }> = {
  '111': { name: 'ADEOLA OKAFOR', status: 'ACTIVE' },
  '222': { name: 'CHIDI EZE', status: 'CLOSED' },
};
const bankVerifier = makeVerifier({
  name: 'bank',
  field: 'accountName',
  applies: (d) => typeof fieldValue(d, 'accountNumber') === 'string',
  lookup: async (d) => {
    const rec = BANK[String(fieldValue(d, 'accountNumber'))];
    return rec ? { value: rec.name, standing: rec.status, source: 'bank-demo' } : null;
  },
});

const run = (pairs: Array<[string, unknown]>) => bankVerifier.enrich(doc(pairs)) as Promise<VerificationEnrichment[]>;

describe('makeVerifier — a custom verifier from just a lookup function', () => {
  it('verifies a matching, in-good-standing account', async () => {
    const [e] = await run([['accountNumber', '111'], ['accountName', 'Adeola Okafor']]);
    expect(e.verifier).toBe('bank');
    expect(e.field).toBe('accountName');
    expect(e.status).toBe('verified');
    expect(e.source).toBe('bank-demo');
  });

  it('flags a mismatch when the authority disagrees', async () => {
    const [e] = await run([['accountNumber', '111'], ['accountName', 'Wrong Person']]);
    expect(e.status).toBe('mismatch');
  });

  it('marks a matched-but-not-in-good-standing account inactive', async () => {
    const [e] = await run([['accountNumber', '222'], ['accountName', 'Chidi Eze']]);
    expect(e.status).toBe('inactive');
  });

  it('reports not_found for an unknown account', async () => {
    const [e] = await run([['accountNumber', '999'], ['accountName', 'Nobody']]);
    expect(e.status).toBe('not_found');
  });

  it('does not run when the gate (applies) is false', async () => {
    expect(await run([['accountName', 'Adeola Okafor']])).toHaveLength(0);
  });

  it('a thrown lookup becomes unavailable (recorded, not silently skipped)', async () => {
    const flaky = makeVerifier({ name: 'bank', field: 'accountName', applies: () => true, lookup: async () => { throw new Error('source down'); } });
    const [e] = (await flaky.enrich(doc([['accountName', 'X']]))) as VerificationEnrichment[];
    expect(e.status).toBe('unavailable');
  });

  it('the verdict folds into the trust loop on its own field', async () => {
    const d = doc([['accountNumber', '111'], ['accountName', 'Wrong Person']]);
    const es = await run([['accountNumber', '111'], ['accountName', 'Wrong Person']]);
    const out = applyEnrichment(d, es);
    const f = out.fields.find((x) => x.fieldPath === 'accountName');
    expect(f?.status).toBe('needs_review');
    expect(f?.signals.bankMismatch).toBe(true);
  });
});
