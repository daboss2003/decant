import { describe, it, expect } from 'vitest';
import { compareNames, buildRegistryEnrichment, applyEnrichment, type RegistryEnrichment } from './enrichment';
import type { DocumentResult } from './pipeline';

describe('compareNames', () => {
  it('treats corporate-suffix differences as a full match', () => {
    expect(compareNames('Acme Nigeria Limited', 'Acme Nigeria Ltd')).toBe(1);
    expect(compareNames('Globex Foods PLC', 'globex foods')).toBe(1);
  });

  it('scores unrelated names low', () => {
    expect(compareNames('Acme Nigeria Limited', 'Zenith Holdings')).toBeLessThan(0.5);
  });

  it('is empty-safe', () => {
    expect(compareNames('', 'Acme')).toBe(0);
  });
});

describe('buildRegistryEnrichment', () => {
  it('verifies a matching name', () => {
    const e = buildRegistryEnrichment({ rcNumber: 'RC1', registeredName: 'Acme Nigeria Limited', extractedName: 'Acme Nigeria Ltd' });
    expect(e.status).toBe('verified');
    expect(e.nameMatchScore).toBe(1);
  });

  it('flags a mismatch', () => {
    const e = buildRegistryEnrichment({ rcNumber: 'RC1', registeredName: 'Acme Nigeria Limited', extractedName: 'Zenith Holdings' });
    expect(e.status).toBe('mismatch');
  });

  it('reports not_found when the RC number is unknown', () => {
    const e = buildRegistryEnrichment({ rcNumber: 'RC9', registeredName: null, extractedName: 'Acme' });
    expect(e.status).toBe('not_found');
    expect(e.registeredName).toBeNull();
  });
});

const cacDoc = (companyName: string): DocumentResult => ({
  documentId: 'c',
  docType: 'cac',
  mode: 'typed',
  pageRange: [0, 0],
  reclassify: false,
  ruleResults: [],
  fields: [
    { fieldPath: 'rcNumber', value: 'RC123456', confidence: 0.95, status: 'auto_approved', signals: {} },
    { fieldPath: 'companyName', value: companyName, confidence: 0.95, status: 'auto_approved', signals: {} },
  ],
});

describe('applyEnrichment', () => {
  it('routes companyName to review on a registry mismatch (external-source safe failure)', () => {
    const doc = cacDoc('Zenith Holdings');
    const e = buildRegistryEnrichment({ rcNumber: 'RC123456', registeredName: 'Acme Nigeria Limited', extractedName: 'Zenith Holdings' });
    const out = applyEnrichment(doc, [e]);
    const name = out.fields.find((f) => f.fieldPath === 'companyName');
    expect(name?.status).toBe('needs_review');
    expect(name?.signals.registryMismatch).toBe(true);
    expect(out.enrichments).toHaveLength(1);
  });

  it('records corroboration (and leaves status) on a verified match', () => {
    const doc = cacDoc('Acme Nigeria Ltd');
    const e = buildRegistryEnrichment({ rcNumber: 'RC123456', registeredName: 'Acme Nigeria Limited', extractedName: 'Acme Nigeria Ltd' });
    const out = applyEnrichment(doc, [e]);
    const name = out.fields.find((f) => f.fieldPath === 'companyName');
    expect(name?.status).toBe('auto_approved');
    expect(name?.signals.registryVerified).toBe(true);
  });

  it('distinguishes not_found from mismatch with its own signal', () => {
    const doc = cacDoc('Acme');
    const e = buildRegistryEnrichment({ rcNumber: 'RC9', registeredName: null, extractedName: 'Acme' });
    const name = applyEnrichment(doc, [e]).fields.find((f) => f.fieldPath === 'companyName');
    expect(name?.status).toBe('needs_review');
    expect(name?.signals.registryNotFound).toBe(true);
    expect(name?.signals.registryMismatch).toBeUndefined();
  });

  it('routes to review with registryUnavailable when the registry could not be reached', () => {
    const doc = cacDoc('Acme');
    const e: RegistryEnrichment = { kind: 'registry', rcNumber: 'RC1', registeredName: null, extractedName: 'Acme', nameMatchScore: 0, status: 'unavailable' };
    const name = applyEnrichment(doc, [e]).fields.find((f) => f.fieldPath === 'companyName');
    expect(name?.status).toBe('needs_review');
    expect(name?.signals.registryUnavailable).toBe(true);
  });
});
