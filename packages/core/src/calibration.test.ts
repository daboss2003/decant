import { describe, it, expect } from 'vitest';
import { applyCalibration, type Calibration } from './calibration';
import fixture from './calibration.fixture.json';

describe('applyCalibration', () => {
  it('Platt: sigmoid(a·x + b)', () => {
    const c: Calibration = { method: 'platt', platt: { a: 2, b: -1 } };
    expect(applyCalibration(c, 0.5)).toBeCloseTo(1 / (1 + Math.exp(-(2 * 0.5 - 1))), 10); // = 0.5
    expect(applyCalibration(c, 1)).toBeCloseTo(1 / (1 + Math.exp(-1)), 10);
  });

  it('Isotonic: piecewise-linear with clipping, monotonic non-decreasing', () => {
    const c: Calibration = { method: 'isotonic', isotonic: { x: [0.2, 0.6, 0.9], y: [0.1, 0.5, 0.8] } };
    expect(applyCalibration(c, 0.1)).toBeCloseTo(0.1); // below range → clipped to first y
    expect(applyCalibration(c, 0.2)).toBeCloseTo(0.1); // at a knot
    expect(applyCalibration(c, 0.4)).toBeCloseTo(0.3); // midway 0.2→0.6 maps 0.1→0.5
    expect(applyCalibration(c, 0.95)).toBeCloseTo(0.8); // above range → clipped to last y
    // monotonic
    let prev = -1;
    for (let x = 0; x <= 1.0001; x += 0.05) {
      const v = applyCalibration(c, x);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('falls back to identity (clamped) when params are missing', () => {
    expect(applyCalibration({ method: 'isotonic' }, 0.7)).toBeCloseTo(0.7);
    expect(applyCalibration({ method: 'platt' }, 1.5)).toBe(1); // clamped
  });

  it('PARITY: matches the scikit-learn sidecar output for every sample point', () => {
    const calib = fixture as unknown as Calibration;
    const samples = (fixture as { samples: Array<{ raw: number; calibrated: number }> }).samples;
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) {
      expect(applyCalibration(calib, s.raw)).toBeCloseTo(s.calibrated, 6);
    }
  });
});
