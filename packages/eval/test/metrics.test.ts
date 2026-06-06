import { describe, it, expect } from 'vitest';
import {
  fieldAccuracy,
  autoApproveFraction,
  silentErrorRate,
  safeFailureRate,
  ece,
  brier,
  reliabilityBins,
  type Scored,
} from '../src/metrics';

describe('metrics', () => {
  it('safe-failure vs silent-error: a wrong field caught vs escaped', () => {
    const caught: Scored[] = [{ confidence: 0.2, correct: false, status: 'needs_review' }];
    expect(safeFailureRate(caught)).toBe(1);
    expect(silentErrorRate(caught)).toBe(0);

    const escaped: Scored[] = [{ confidence: 0.95, correct: false, status: 'auto_approved' }];
    expect(safeFailureRate(escaped)).toBe(0);
    expect(silentErrorRate(escaped)).toBe(1);
  });

  it('field accuracy + auto-approve fraction', () => {
    const s: Scored[] = [
      { confidence: 0.95, correct: true, status: 'auto_approved' },
      { confidence: 0.2, correct: false, status: 'needs_review' },
    ];
    expect(fieldAccuracy(s)).toBeCloseTo(0.5);
    expect(autoApproveFraction(s)).toBeCloseTo(0.5);
  });

  it('ECE + Brier on a known overconfident set', () => {
    // both at conf 0.9, one right one wrong → one bin: meanConf 0.9, acc 0.5
    const s: Scored[] = [
      { confidence: 0.9, correct: true, status: 'auto_approved' },
      { confidence: 0.9, correct: false, status: 'auto_approved' },
    ];
    expect(ece(s)).toBeCloseTo(0.4, 5); // |0.5 - 0.9|
    expect(brier(s)).toBeCloseTo((0.01 + 0.81) / 2, 5);
  });

  it('reliability bins place items by confidence', () => {
    const s: Scored[] = [
      { confidence: 0.95, correct: true, status: 'auto_approved' },
      { confidence: 0.15, correct: false, status: 'needs_review' },
    ];
    const bins = reliabilityBins(s);
    expect(bins[9]?.count).toBe(1); // 0.9-1.0
    expect(bins[1]?.count).toBe(1); // 0.1-0.2
  });
});
