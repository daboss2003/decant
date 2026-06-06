import { describe, it, expect } from 'vitest';
import { normalizeBankStatement, bankStatementRules } from '../../src/rules/bank-statement.rules';
import type { BankStatementCanonical } from '@decant/schemas';

const ef = (v: unknown) => ({ value: v, modelConfidence: 0.9, sourceQuote: v === null ? null : String(v) });

type Row = { date?: string; debit?: number; credit?: number; balance: number };
const tx = (o: Row) => ({
  date: ef(o.date ?? '2026-05-01'),
  description: ef('x'),
  debit: ef(o.debit ?? 0),
  credit: ef(o.credit ?? 0),
  balance: ef(o.balance),
  valueDate: ef(null),
  reference: ef(null),
});

function stmt(o: { opening: number | null; closing: number | null; txs: Row[] }): BankStatementCanonical {
  return normalizeBankStatement({
    bankName: ef('GTBank'),
    accountName: ef('A. Customer'),
    accountNumber: ef('0123456789'),
    statementPeriodStart: ef('2026-05-01'),
    statementPeriodEnd: ef('2026-05-31'),
    currency: ef('NGN'),
    openingBalance: ef(o.opening),
    closingBalance: ef(o.closing),
    transactions: o.txs.map(tx),
    // cast: fixture mirrors the extraction shape closely enough for normalize
  } as Parameters<typeof normalizeBankStatement>[0]);
}

const run = (d: BankStatementCanonical) => bankStatementRules.map((r) => r(d));
const failedGates = (d: BankStatementCanonical) => run(d).filter((r) => r.severity === 'GATE' && !r.passed);
const rule = (d: BankStatementCanonical, name: string) => run(d).find((r) => r.rule === name);

describe('bank statement reconciliation', () => {
  it('clean statement: every GATE passes', () => {
    // opening 1000; +500 → 1500; −200 → 1300; closing 1300
    const d = stmt({
      opening: 1000,
      closing: 1300,
      txs: [
        { credit: 500, balance: 1500 },
        { debit: 200, balance: 1300 },
      ],
    });
    expect(failedGates(d)).toHaveLength(0);
  });

  it('running-balance walk LOCALIZES the bad row', () => {
    // row 0 balance misread as 9999 (should be 1500)
    const d = stmt({
      opening: 1000,
      closing: 1300,
      txs: [
        { credit: 500, balance: 9999 },
        { debit: 200, balance: 1300 },
      ],
    });
    const walk = rule(d, 'running_balance_walk');
    expect(walk?.passed).toBe(false);
    expect(walk?.fields).toContain('transactions.0.balance');
  });

  it('endpoint reconciliation flags the balance endpoints when closing is wrong', () => {
    const d = stmt({
      opening: 1000,
      closing: 9999,
      txs: [
        { credit: 500, balance: 1500 },
        { debit: 200, balance: 1300 },
      ],
    });
    const ep = rule(d, 'endpoint_reconciliation');
    expect(ep?.passed).toBe(false);
    expect(ep?.fields).toContain('closingBalanceMinor');
  });

  it('flags a row holding both a debit and a credit', () => {
    const d = stmt({
      opening: 1000,
      closing: 1300,
      txs: [
        { credit: 500, balance: 1500 },
        { debit: 200, credit: 50, balance: 1300 },
      ],
    });
    const xor = rule(d, 'debit_xor_credit');
    expect(xor?.passed).toBe(false);
    expect(xor?.fields).toContain('transactions.1.debit');
  });

  it('opening/closing presence GATEs fire when missing', () => {
    const d = stmt({ opening: null, closing: 1300, txs: [] });
    expect(rule(d, 'opening_balance_present')?.passed).toBe(false);
  });
});
