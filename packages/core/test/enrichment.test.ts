import { describe, it, expect } from 'vitest';
import { compareNames, buildVerification, unavailableVerification, applyEnrichment } from '../src/enrichment';
import type { DocumentResult } from '../src/pipeline';

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

const reg = (extractedValue: string | null, record: Parameters<typeof buildVerification>[0]['record']) =>
  buildVerification({ verifier: 'registry', field: 'companyName', extractedValue, record });

describe('buildVerification', () => {
  it('verifies a matching value in good standing', () => {
    const e = reg('Acme Nigeria Ltd', { value: 'Acme Nigeria Limited', standing: 'ACTIVE' });
    expect(e.status).toBe('verified');
    expect(e.matchScore).toBe(1);
  });

  it('flags a mismatch', () => {
    expect(reg('Zenith Holdings', { value: 'Acme Nigeria Limited' }).status).toBe('mismatch');
  });

  it('reports not_found when the record is null', () => {
    const e = reg('Acme', null);
    expect(e.status).toBe('not_found');
    expect(e.authoritativeValue).toBeNull();
  });

  it('marks a name match on a not-in-good-standing record as inactive', () => {
    expect(reg('Acme Nigeria Ltd', { value: 'Acme Nigeria Limited', standing: 'INACTIVE' }).status).toBe('inactive');
  });

  it('carries source + reference (e.g. LEI) for the audit trail', () => {
    const e = reg('Acme Nigeria Ltd', { value: 'Acme Nigeria Limited', standing: 'ACTIVE', source: 'gleif', reference: 'LEI123' });
    expect(e.status).toBe('verified');
    expect(e.source).toBe('gleif');
    expect(e.reference).toBe('LEI123');
  });

  it('supports a custom comparator (e.g. exact-match for IDs)', () => {
    const exact = (a: string, b: string) => (a === b ? 1 : 0);
    expect(buildVerification({ verifier: 'taxId', field: 'taxId', extractedValue: '123', record: { value: '123' }, compare: exact }).status).toBe('verified');
    expect(buildVerification({ verifier: 'taxId', field: 'taxId', extractedValue: '124', record: { value: '123' }, compare: exact }).status).toBe('mismatch');
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
  it('routes the field to review on a mismatch with a verifier-scoped signal', () => {
    const out = applyEnrichment(cacDoc('Zenith Holdings'), [reg('Zenith Holdings', { value: 'Acme Nigeria Limited' })]);
    const name = out.fields.find((f) => f.fieldPath === 'companyName');
    expect(name?.status).toBe('needs_review');
    expect(name?.signals.registryMismatch).toBe(true);
    expect(out.enrichments).toHaveLength(1);
  });

  it('records corroboration (and leaves status) on a verified match', () => {
    const out = applyEnrichment(cacDoc('Acme Nigeria Ltd'), [reg('Acme Nigeria Ltd', { value: 'Acme Nigeria Limited', standing: 'ACTIVE' })]);
    const name = out.fields.find((f) => f.fieldPath === 'companyName');
    expect(name?.status).toBe('auto_approved');
    expect(name?.signals.registryVerified).toBe(true);
  });

  it('distinguishes not_found / inactive / unavailable, each with its own signal', () => {
    const nf = applyEnrichment(cacDoc('Acme'), [reg('Acme', null)]).fields.find((f) => f.fieldPath === 'companyName');
    expect(nf?.status).toBe('needs_review');
    expect(nf?.signals.registryNotFound).toBe(true);
    expect(nf?.signals.registryMismatch).toBeUndefined();

    const inactive = applyEnrichment(cacDoc('Acme Nigeria Ltd'), [reg('Acme Nigeria Ltd', { value: 'Acme Nigeria Limited', standing: 'INACTIVE' })])
      .fields.find((f) => f.fieldPath === 'companyName');
    expect(inactive?.signals.registryInactive).toBe(true);

    const un = applyEnrichment(cacDoc('Acme'), [unavailableVerification('registry', 'companyName', 'Acme')])
      .fields.find((f) => f.fieldPath === 'companyName');
    expect(un?.status).toBe('needs_review');
    expect(un?.signals.registryUnavailable).toBe(true);
  });

  it('a custom verifier folds onto its own field with its own signal key', () => {
    const doc: DocumentResult = {
      documentId: 'd', docType: 'invoice', mode: 'typed', pageRange: [0, 0], reclassify: false, ruleResults: [],
      fields: [{ fieldPath: 'taxId', value: '124', confidence: 0.9, status: 'auto_approved', signals: {} }],
    };
    const v = buildVerification({ verifier: 'taxId', field: 'taxId', extractedValue: '124', record: { value: '123' }, compare: (a, b) => (a === b ? 1 : 0) });
    const f = applyEnrichment(doc, [v]).fields.find((x) => x.fieldPath === 'taxId');
    expect(f?.status).toBe('needs_review');
    expect(f?.signals.taxIdMismatch).toBe(true);
  });
});
