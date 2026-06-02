import type { RuleResult } from '../registry';

/** ±1 minor-unit tolerance for all reconciliation (plan §6.4). */
export const TOLERANCE = 1;
export const eqWithin = (a: number, b: number, tol = TOLERANCE): boolean => Math.abs(a - b) <= tol;

export const gate = (rule: string, passed: boolean, fields: string[], detail?: string): RuleResult => ({
  rule,
  severity: 'GATE',
  passed,
  fields,
  detail,
});

export const signal = (rule: string, passed: boolean, fields: string[], detail?: string): RuleResult => ({
  rule,
  severity: 'SIGNAL',
  passed,
  fields,
  detail,
});
