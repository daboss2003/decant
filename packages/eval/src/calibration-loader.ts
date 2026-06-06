import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Calibration, CalibrationSet } from '@decant/core';

/**
 * Load a fitted calibrator (the offline Python sidecar's `calibration.json`) so a
 * runtime adapter maps raw confidence → calibrated probability. Shared by every
 * adapter (CLI, REST API, MCP) so calibrated routing is identical everywhere.
 *
 * Resolution order:
 *   1. `DECANT_CALIBRATION` — an explicit path (use this in prod / split deploys);
 *   2. `../../reports/eval/calibration.json` relative to cwd — the sidecar's
 *      default output, which resolves to the repo root for adapters run from
 *      `apps/<name>` (two levels down).
 *
 * Returns `undefined` when no calibrator exists (→ the pipeline uses raw scores)
 * or the file is unreadable/invalid — calibration is always optional, never fatal.
 */
export function loadCalibration(): Calibration | CalibrationSet | undefined {
  const path = process.env.DECANT_CALIBRATION ?? resolve(process.cwd(), '../../reports/eval/calibration.json');
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Calibration | CalibrationSet;
  } catch {
    return undefined;
  }
}
