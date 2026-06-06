import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Calibration, CalibrationSet } from '@decant/core';

/**
 * Runtime loader for the offline-fitted calibrator (the Python sidecar's
 * `calibration.json`) so a prod adapter maps raw confidence → calibrated
 * probability. Shared by every runtime adapter (CLI, REST API, MCP).
 *
 * Lives in `@decant/db` — the shared runtime-IO package every adapter already
 * depends on — deliberately: `@decant/core` is node-free (no fs), and the eval
 * harness (`@decant/eval`, which *produces* calibrators) is offline-only tooling
 * that production code must not import.
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
