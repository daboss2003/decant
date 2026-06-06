import { describe, it, expect } from 'vitest';
import { normalizeCac, cacRules } from '../../src/rules/cac.rules';
import type { CacCanonical } from '@decant/schemas';

const ef = (v: unknown) => ({ value: v, modelConfidence: 0.9, sourceQuote: v === null ? null : String(v) });

interface CacOpts {
  rc?: string | null;
  name?: string | null;
  entityType?: string;
  date?: string | null;
  authorized?: number | null;
  issued?: number | null;
  issuedShares?: number | null;
  directors?: number;
  shareholders?: Array<{ numShares: number }>;
}

function cac(o: CacOpts = {}): CacCanonical {
  return normalizeCac({
    rcNumber: ef(o.rc === undefined ? 'RC 123456' : o.rc),
    companyName: ef(o.name === undefined ? 'Neable Ltd' : o.name),
    entityType: ef(o.entityType ?? 'LTD'),
    registrationDate: ef(o.date === undefined ? '2020-03-04' : o.date),
    registeredAddress: ef('Lagos'),
    currency: ef('NGN'),
    authorizedCapital: ef(o.authorized ?? 1_000_000),
    issuedCapital: ef(o.issued ?? 500_000),
    issuedShares: ef(o.issuedShares ?? 1000),
    natureOfBusiness: ef('Software'),
    status: ef('Active'),
    directors: Array.from({ length: o.directors ?? 2 }, (_, i) => ({
      name: ef(`Director ${i}`),
      address: ef('Lagos'),
      nationality: ef('Nigerian'),
      sharesHeld: ef(500),
    })),
    shareholders: (o.shareholders ?? [{ numShares: 600 }, { numShares: 400 }]).map((s) => ({
      name: ef('Holder'),
      numShares: ef(s.numShares),
      shareValue: ef(1),
    })),
  } as Parameters<typeof normalizeCac>[0]);
}

const run = (d: CacCanonical) => cacRules.map((r) => r(d));
const failedGates = (d: CacCanonical) => run(d).filter((r) => r.severity === 'GATE' && !r.passed);
const rule = (d: CacCanonical, name: string) => run(d).find((r) => r.rule === name);

describe('CAC rules', () => {
  it('clean CAC: every GATE passes (RC normalized, shares reconcile)', () => {
    const d = cac();
    expect(d.rcNumber).toBe('RC123456'); // spaces stripped, uppercased
    expect(failedGates(d)).toHaveLength(0);
    expect(rule(d, 'shareholders_sum_to_issued_shares')?.passed).toBe(true); // 600+400 == 1000
  });

  it('malformed RC number fails the GATE', () => {
    expect(rule(cac({ rc: 'NOT-AN-RC' }), 'rc_number_valid')?.passed).toBe(false);
    expect(rule(cac({ rc: null }), 'rc_number_valid')?.passed).toBe(false);
    expect(rule(cac({ rc: '123456' }), 'rc_number_valid')?.passed).toBe(true); // bare digits ok
  });

  it('issued capital over authorized fails the GATE', () => {
    expect(rule(cac({ authorized: 100, issued: 999 }), 'issued_not_over_authorized')?.passed).toBe(false);
  });

  it('shareholder shares not summing to issued shares trips the SIGNAL', () => {
    const d = cac({ issuedShares: 1000, shareholders: [{ numShares: 600 }, { numShares: 100 }] });
    expect(rule(d, 'shareholders_sum_to_issued_shares')?.passed).toBe(false);
  });

  it('missing registration date fails the GATE', () => {
    expect(rule(cac({ date: null }), 'registration_date_present')?.passed).toBe(false);
  });
});
