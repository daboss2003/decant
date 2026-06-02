import { describe, it, expect } from 'vitest';
import { ThresholdRoutingService } from './routing.service';
import type { FieldConfidence, ValidationOutcome } from '../services';
import type { RuleResult } from '../registry';

const svc = new ThresholdRoutingService(); // default τ = 0.9
const fc = (fieldPath: string, confidence: number): FieldConfidence => ({ fieldPath, confidence, signals: {} });
const validation = (results: RuleResult[], reclassify = false): ValidationOutcome => ({ results, reclassify });

describe('ThresholdRoutingService', () => {
  it('auto-approves a high-confidence typed field with no gate failure', () => {
    expect(svc.route([fc('total', 0.95)], validation([]), 'typed').get('total')).toBe('auto_approved');
  });

  it('routes a low-confidence field to review', () => {
    expect(svc.route([fc('total', 0.5)], validation([]), 'typed').get('total')).toBe('needs_review');
  });

  it('forces review when a GATE implicating the field failed, even at high confidence', () => {
    const v = validation([{ rule: 'total_present', severity: 'GATE', passed: false, fields: ['totalMinor'] }]);
    expect(svc.route([fc('total', 0.99)], v, 'typed').get('total')).toBe('needs_review');
  });

  it('routes ALL generic-mode fields to review regardless of confidence', () => {
    expect(svc.route([fc('landlord', 1)], validation([]), 'generic').get('landlord')).toBe('needs_review');
  });

  it('routes everything to review when the doc is flagged for reclassification', () => {
    expect(svc.route([fc('total', 1)], validation([], true), 'typed').get('total')).toBe('needs_review');
  });

  it('honors per-field-type threshold overrides', () => {
    const strict = new ThresholdRoutingService({ defaultThreshold: 0.9, thresholds: { total: 0.99 } });
    expect(strict.route([fc('total', 0.95)], validation([]), 'typed').get('total')).toBe('needs_review');
  });
});
