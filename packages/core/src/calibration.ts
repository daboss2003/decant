/**
 * Runtime calibration APPLY (plan §3.3). The Python sidecar (packages/calibrate)
 * FITS the calibrator with scikit-learn and emits these params; here we apply them
 * at runtime to map a raw confidence → a calibrated probability. Kept tiny and
 * dependency-free; parity with the sklearn fit is verified by a golden-vector test.
 */
export interface PlattParams {
  a: number;
  b: number;
}
export interface IsotonicParams {
  /** Ascending breakpoint x's (X_thresholds_ from sklearn). */
  x: number[];
  /** Corresponding y's (y_thresholds_). */
  y: number[];
}
export interface Calibration {
  method: 'platt' | 'isotonic';
  platt?: PlattParams | null;
  isotonic?: IsotonicParams | null;
}

/**
 * A set of calibrators (plan §3.3 — calibrate per doc type when there's enough
 * data, else fall back to a global one). The sidecar emits this shape; the
 * service resolves the right calibrator by the document's type.
 */
export interface CalibrationSet {
  default?: Calibration | null;
  byType?: Record<string, Calibration> | null;
}

/** Pick the calibrator for a doc type: a per-type one if present, else the default. */
export function resolveCalibration(
  c: Calibration | CalibrationSet | undefined,
  docType: string,
): Calibration | undefined {
  if (!c) return undefined;
  if ('method' in c) return c; // a single bare calibrator applies to everything
  return c.byType?.[docType] ?? c.default ?? undefined;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

/** Piecewise-linear interpolation over (x,y) with clipping — matches sklearn IsotonicRegression(out_of_bounds='clip'). */
function applyIsotonic(p: IsotonicParams, raw: number): number {
  const { x, y } = p;
  const n = x.length;
  if (n === 0) return clamp01(raw);
  if (raw <= x[0]!) return clamp01(y[0]!);
  if (raw >= x[n - 1]!) return clamp01(y[n - 1]!);
  let i = 1;
  while (i < n && x[i]! < raw) i++;
  const x0 = x[i - 1]!;
  const x1 = x[i]!;
  const y0 = y[i - 1]!;
  const y1 = y[i]!;
  const t = x1 === x0 ? 0 : (raw - x0) / (x1 - x0);
  return clamp01(y0 + t * (y1 - y0));
}

/** Map a raw confidence to a calibrated probability using fitted params. */
export function applyCalibration(c: Calibration, raw: number): number {
  if (c.method === 'platt' && c.platt) return clamp01(sigmoid(c.platt.a * raw + c.platt.b));
  if (c.method === 'isotonic' && c.isotonic) return applyIsotonic(c.isotonic, raw);
  return clamp01(raw);
}
