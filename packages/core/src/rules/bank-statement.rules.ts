import type { BankStatementCanonical, BankStatementExtraction } from '@decant/schemas';
import type { DomainRule } from '../registry';
import { toMinor, normalizeDate, normalizeCurrency } from './normalize';
import { eqWithin, gate, signal } from './rule-helpers';

/**
 * Bank statement normalization + reconciliation rules (plan §6.2). The
 * running-balance walk is the centerpiece: it LOCALIZES errors to the exact
 * row(s), so only the bad rows route to review while the rest auto-approve.
 */
export function normalizeBankStatement(x: BankStatementExtraction): BankStatementCanonical {
  const txs = Array.isArray(x?.transactions) ? x.transactions : [];
  return {
    bankName: x?.bankName?.value ?? null,
    accountName: x?.accountName?.value ?? null,
    accountNumber: x?.accountNumber?.value ?? null,
    statementPeriodStart: normalizeDate(x?.statementPeriodStart?.value ?? null),
    statementPeriodEnd: normalizeDate(x?.statementPeriodEnd?.value ?? null),
    currency: normalizeCurrency(x?.currency?.value ?? null),
    openingBalanceMinor: toMinor(x?.openingBalance?.value ?? null),
    closingBalanceMinor: toMinor(x?.closingBalance?.value ?? null),
    transactions: txs.map((t) => ({
      date: normalizeDate(t?.date?.value ?? null),
      description: t?.description?.value ?? null,
      debitMinor: toMinor(t?.debit?.value ?? null),
      creditMinor: toMinor(t?.credit?.value ?? null),
      balanceMinor: toMinor(t?.balance?.value ?? null),
      valueDate: normalizeDate(t?.valueDate?.value ?? null),
      reference: t?.reference?.value ?? null,
    })),
  };
}

export const bankStatementRules: DomainRule<BankStatementCanonical>[] = [
  // [GATE] opening & closing balances must be present to reconcile at all.
  (d) => gate('opening_balance_present', d.openingBalanceMinor !== null, ['openingBalanceMinor']),
  (d) => gate('closing_balance_present', d.closingBalanceMinor !== null, ['closingBalanceMinor']),

  // [GATE] Running-balance walk: balance[i] == prev + credit − debit, seeded by
  // opening. Reports the exact failing row(s) → per-row localization (plan §6.2).
  (d) => {
    if (d.openingBalanceMinor === null)
      return gate('running_balance_walk', true, ['transactions'], 'no opening balance — skipped');
    const bad: number[] = [];
    let prev = d.openingBalanceMinor;
    d.transactions.forEach((t, i) => {
      if (t.balanceMinor === null) return; // can't verify this row; keep prev
      const expected = prev + (t.creditMinor ?? 0) - (t.debitMinor ?? 0);
      if (!eqWithin(expected, t.balanceMinor)) bad.push(i);
      prev = t.balanceMinor; // continue from the STATED balance (so it re-aligns)
    });
    const fields = bad.flatMap((i) => [
      `transactions.${i}.balance`,
      `transactions.${i}.debit`,
      `transactions.${i}.credit`,
    ]);
    return gate(
      'running_balance_walk',
      bad.length === 0,
      fields.length ? fields : ['transactions'],
      bad.length ? `rows ${bad.join(', ')} don't reconcile` : undefined,
    );
  },

  // [GATE] Endpoint: opening + Σcredit − Σdebit == closing. Implicates only the
  // balance endpoints (the walk localizes the rows), so a global mismatch flags
  // opening/closing rather than flooding every row.
  (d) => {
    if (d.openingBalanceMinor === null || d.closingBalanceMinor === null)
      return gate('endpoint_reconciliation', true, ['openingBalanceMinor', 'closingBalanceMinor'], 'missing endpoints — skipped');
    const net = d.transactions.reduce((s, t) => s + (t.creditMinor ?? 0) - (t.debitMinor ?? 0), 0);
    return gate(
      'endpoint_reconciliation',
      eqWithin(d.openingBalanceMinor + net, d.closingBalanceMinor),
      ['openingBalanceMinor', 'closingBalanceMinor'],
      `opening+net=${d.openingBalanceMinor + net} vs closing=${d.closingBalanceMinor}`,
    );
  },

  // [SIGNAL] each row should have exactly one of debit / credit non-zero.
  (d) => {
    const bad = d.transactions.flatMap((t, i) =>
      (t.debitMinor ?? 0) !== 0 && (t.creditMinor ?? 0) !== 0 ? [i] : [],
    );
    const fields = bad.flatMap((i) => [`transactions.${i}.debit`, `transactions.${i}.credit`]);
    return signal(
      'debit_xor_credit',
      bad.length === 0,
      fields.length ? fields : ['transactions'],
      bad.length ? `rows ${bad.join(', ')} have both debit and credit` : undefined,
    );
  },

  // [SIGNAL] transaction dates non-decreasing.
  (d) => {
    const bad: number[] = [];
    for (let i = 1; i < d.transactions.length; i++) {
      const a = d.transactions[i - 1]?.date;
      const b = d.transactions[i]?.date;
      if (a && b && b < a) bad.push(i);
    }
    const fields = bad.map((i) => `transactions.${i}.date`);
    return signal(
      'dates_non_decreasing',
      bad.length === 0,
      fields.length ? fields : ['transactions'],
      bad.length ? `rows ${bad.join(', ')} out of date order` : undefined,
    );
  },

  // [SIGNAL] currency resolved to ISO-4217.
  (d) => signal('currency_present', d.currency !== null, ['currency']),
];
