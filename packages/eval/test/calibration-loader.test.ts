import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCalibration } from '../src/calibration-loader';

const dir = mkdtempSync(join(tmpdir(), 'decant-cal-'));
afterEach(() => {
  delete process.env.DECANT_CALIBRATION;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadCalibration (shared by CLI / API / MCP)', () => {
  it('returns undefined when the file does not exist (→ raw scores, never fatal)', () => {
    process.env.DECANT_CALIBRATION = join(dir, 'nope.json');
    expect(loadCalibration()).toBeUndefined();
  });

  it('parses a fitted calibrator from DECANT_CALIBRATION', () => {
    const p = join(dir, 'calibration.json');
    const cal = { default: { method: 'platt', platt: { a: 1.2, b: -0.3 } }, byType: {} };
    writeFileSync(p, JSON.stringify(cal));
    process.env.DECANT_CALIBRATION = p;
    expect(loadCalibration()).toEqual(cal);
  });

  it('returns undefined on invalid JSON (never throws)', () => {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{ not valid json');
    process.env.DECANT_CALIBRATION = p;
    expect(loadCalibration()).toBeUndefined();
  });
});
