import type { FieldStatus } from '@decant/core';

/**
 * The success-criteria metrics (plan §4), hand-rolled in TS (no maintained npm
 * calibration lib exists; these are small, verifiable formulas). Operates over a
 * flat list of scored field instances.
 */
export interface Scored {
  confidence: number;
  correct: boolean;
  status: FieldStatus;
}

export const fieldAccuracy = (s: Scored[]): number =>
  s.length ? s.filter((x) => x.correct).length / s.length : 0;

/** Fraction of fields the system auto-approved (the human-effort-saved number). */
export const autoApproveFraction = (s: Scored[]): number =>
  s.length ? s.filter((x) => x.status === 'auto_approved').length / s.length : 0;

/** WORST outcome: wrong AND auto-approved (a confidently-asserted error). Minimize. */
export const silentErrorRate = (s: Scored[]): number =>
  s.length ? s.filter((x) => !x.correct && x.status === 'auto_approved').length / s.length : 0;

/** Of the fields the system got WRONG, the fraction it caught (routed to review). */
export function safeFailureRate(s: Scored[]): number {
  const wrong = s.filter((x) => !x.correct);
  if (wrong.length === 0) return 1;
  return wrong.filter((x) => x.status !== 'auto_approved').length / wrong.length;
}

export interface ReliabilityBin {
  lo: number;
  hi: number;
  count: number;
  meanConfidence: number;
  accuracy: number;
}

/** Reliability-diagram bins (the data behind the hero artifact). */
export function reliabilityBins(s: Scored[], nBins = 10): ReliabilityBin[] {
  const bins: ReliabilityBin[] = [];
  for (let b = 0; b < nBins; b++) {
    const lo = b / nBins;
    const hi = (b + 1) / nBins;
    const inBin = s.filter((x) =>
      b === nBins - 1 ? x.confidence >= lo && x.confidence <= hi : x.confidence >= lo && x.confidence < hi,
    );
    const count = inBin.length;
    bins.push({
      lo,
      hi,
      count,
      meanConfidence: count ? inBin.reduce((a, x) => a + x.confidence, 0) / count : 0,
      accuracy: count ? inBin.filter((x) => x.correct).length / count : 0,
    });
  }
  return bins;
}

/** Expected Calibration Error: weighted average gap between confidence and accuracy. */
export function ece(s: Scored[], nBins = 10): number {
  if (!s.length) return 0;
  return reliabilityBins(s, nBins).reduce(
    (acc, b) => acc + (b.count / s.length) * Math.abs(b.accuracy - b.meanConfidence),
    0,
  );
}

/** Brier score: mean squared error of the probabilistic predictions (lower = better). */
export function brier(s: Scored[]): number {
  if (!s.length) return 0;
  return s.reduce((a, x) => a + (x.confidence - (x.correct ? 1 : 0)) ** 2, 0) / s.length;
}

export interface SweepPoint {
  tau: number;
  autoApproveFraction: number;
  silentErrorRate: number;
}

/** What-if τ sweep: pick the threshold that hits a target silent-error budget (plan §3.5). */
export function thresholdSweep(s: Scored[], step = 0.05): SweepPoint[] {
  const out: SweepPoint[] = [];
  for (let raw = 0; raw <= 1.0000001; raw += step) {
    const tau = Math.round(raw * 100) / 100;
    const auto = s.filter((x) => x.confidence >= tau);
    out.push({
      tau,
      autoApproveFraction: s.length ? auto.length / s.length : 0,
      silentErrorRate: s.length ? auto.filter((x) => !x.correct).length / s.length : 0,
    });
  }
  return out;
}
