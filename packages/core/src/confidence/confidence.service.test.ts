import { describe, it, expect } from 'vitest';
import { HeuristicConfidenceService } from './confidence.service';
import type { ExtractedDocument, ValidationOutcome } from '../services';
import type { RuleResult } from '../registry';

const svc = new HeuristicConfidenceService();

const doc = (mode: 'typed' | 'generic', raw: unknown): ExtractedDocument => ({
  documentId: 'd1',
  docType: 'receipt',
  mode,
  raw,
});
const validation = (results: RuleResult[], reclassify = false): ValidationOutcome => ({ results, reclassify });
const gate = (rule: string, passed: boolean, fields: string[]): RuleResult => ({ rule, severity: 'GATE', passed, fields });
const signal = (rule: string, passed: boolean, fields: string[]): RuleResult => ({ rule, severity: 'SIGNAL', passed, fields });

describe('HeuristicConfidenceService', () => {
  it('floors a field when a GATE implicating it fails (joins totalMinor↔total)', async () => {
    const d = doc('typed', { total: { value: null, modelConfidence: 0.95, sourceQuote: null } });
    const out = await svc.score(d, validation([gate('total_present', false, ['totalMinor'])]), 1);
    const total = out.find((f) => f.fieldPath === 'total');
    expect(total?.confidence).toBeLessThanOrEqual(0.15);
    expect(total?.signals.gateFailed).toBe(true);
  });

  it('boosts a field when a reconciliation GATE passes (the math vouches)', async () => {
    const d = doc('typed', { total: { value: 1075, modelConfidence: 0.6, sourceQuote: '1075' } });
    const out = await svc.score(d, validation([gate('subtotal_tax_tip_discount_equals_total', true, ['totalMinor'])]), 1);
    expect(out[0]?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('scales down on a failed SIGNAL', async () => {
    const d = doc('typed', { merchantName: { value: '', modelConfidence: 1, sourceQuote: null } });
    const out = await svc.score(d, validation([signal('merchant_name_present', false, ['merchantName'])]), 1);
    expect(out[0]?.confidence).toBeCloseTo(0.6, 5);
  });

  it('drags confidence down by the classification confidence (mis-route risk)', async () => {
    const d = doc('typed', { total: { value: 1, modelConfidence: 1, sourceQuote: null } });
    const out = await svc.score(d, validation([]), 0.5);
    expect(out[0]?.confidence).toBeCloseTo(0.5, 5);
  });

  it('caps generic-mode confidence and uses the field `name` as the path', async () => {
    const d = doc('generic', { fields: [{ name: 'landlord', value: 'X', modelConfidence: 1, sourceQuote: null }] });
    const out = await svc.score(d, validation([]), 1);
    expect(out[0]?.fieldPath).toBe('landlord');
    expect(out[0]?.confidence).toBeLessThanOrEqual(0.5);
  });
});
