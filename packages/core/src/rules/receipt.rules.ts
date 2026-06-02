import type { ReceiptCanonical, ReceiptExtraction } from '@decant/schemas';
import type { DomainRule, RuleResult } from '../registry';

/**
 * Receipt / invoice normalization + domain rules (plan §6.1).
 * All reconciliation is integer minor-unit math with a ±1 unit tolerance (§6.4).
 *
 * Fail-safe principle (plan §3): a MISSING required value never silently passes —
 * it routes to review. And normalization NEVER throws — bad values become null
 * and get flagged by the rules, rather than crashing the pipeline.
 */

const TOLERANCE = 1; // ±1 minor unit
const eqWithin = (a: number, b: number, tol = TOLERANCE) => Math.abs(a - b) <= tol;

const gate = (rule: string, passed: boolean, fields: string[], detail?: string): RuleResult => ({
  rule,
  severity: 'GATE',
  passed,
  fields,
  detail,
});
const signal = (rule: string, passed: boolean, fields: string[], detail?: string): RuleResult => ({
  rule,
  severity: 'SIGNAL',
  passed,
  fields,
  detail,
});

/** Major-unit number (e.g. 1234.5) → integer minor units (kobo). */
export function toMinor(amount: number | null, exponent = 2): number | null {
  if (amount === null || Number.isNaN(amount)) return null;
  return Math.round(amount * 10 ** exponent);
}

// TODO(M0): replace with date-fns `parse` over NG day-first candidates (plan §4).
// Placeholder: only recognises an already-ISO prefix, else null.
function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Map ₦ / "N" / Naira / 3-letter codes to ISO-4217; else null. Never throws. */
function normalizeCurrency(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  if (s.includes('₦') || s === 'N' || s.startsWith('NAIRA') || s === 'NGN') return 'NGN';
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

/**
 * Map raw Gemini extraction → canonical (money in minor units, ISO dates).
 * Deliberately does NOT call ReceiptCanonical.parse() — a ZodError would crash
 * the pipeline. Coercion is defensive; correctness is enforced by the rules.
 */
export function normalizeReceipt(x: ReceiptExtraction): ReceiptCanonical {
  // Optional chaining throughout: a malformed/partial model response (e.g. a
  // failed structured-output parse) must produce nulls, never crash.
  const lines = Array.isArray(x?.lineItems) ? x.lineItems : [];
  return {
    merchantName: x?.merchantName?.value ?? null,
    merchantTaxId: x?.merchantTaxId?.value ?? null,
    transactionDate: normalizeDate(x?.transactionDate?.value ?? null),
    currency: normalizeCurrency(x?.currency?.value ?? null),
    lineItems: lines.map((li) => ({
      description: li?.description?.value ?? null,
      qty: li?.qty?.value ?? null,
      unitPriceMinor: toMinor(li?.unitPrice?.value ?? null),
      lineTotalMinor: toMinor(li?.lineTotal?.value ?? null),
    })),
    subtotalMinor: toMinor(x?.subtotal?.value ?? null),
    taxMinor: toMinor(x?.tax?.value ?? null),
    tipMinor: toMinor(x?.tip?.value ?? null),
    discountMinor: toMinor(x?.discount?.value ?? null),
    totalMinor: toMinor(x?.total?.value ?? null),
    paymentMethod: x?.paymentMethod?.value ?? null,
  };
}

export const receiptRules: DomainRule<ReceiptCanonical>[] = [
  // [GATE] total must be present — a missing total can't be trusted/auto-approved.
  (d) => gate('total_present', d.totalMinor !== null, ['totalMinor'], 'total missing → review'),

  // [GATE] Σ line totals == subtotal (skipped when subtotal absent)
  (d) => {
    if (d.subtotalMinor === null)
      return gate('line_items_sum_to_subtotal', true, ['subtotalMinor', 'lineItems'], 'no subtotal — skipped');
    const sum = d.lineItems.reduce((s, li) => s + (li.lineTotalMinor ?? 0), 0);
    return gate(
      'line_items_sum_to_subtotal',
      eqWithin(sum, d.subtotalMinor),
      ['subtotalMinor', 'lineItems'],
      `Σ line_total=${sum} vs subtotal=${d.subtotalMinor}`,
    );
  },

  // [GATE] subtotal + tax + tip − discount == total (when total present;
  // null total is handled by `total_present` above, so pass-through here)
  (d) =>
    gate(
      'subtotal_tax_tip_discount_equals_total',
      d.totalMinor === null ||
        eqWithin(
          (d.subtotalMinor ?? 0) + (d.taxMinor ?? 0) + (d.tipMinor ?? 0) - (d.discountMinor ?? 0),
          d.totalMinor,
        ),
      ['totalMinor', 'subtotalMinor', 'taxMinor', 'tipMinor', 'discountMinor'],
    ),

  // [SIGNAL] per line: qty * unitPrice == lineTotal
  (d) => {
    const badRow = d.lineItems.findIndex(
      (li) =>
        li.qty !== null &&
        li.unitPriceMinor !== null &&
        li.lineTotalMinor !== null &&
        !eqWithin(Math.round(li.qty * li.unitPriceMinor), li.lineTotalMinor),
    );
    return signal(
      'line_qty_times_unit_price',
      badRow === -1,
      ['lineItems'],
      badRow === -1 ? undefined : `row ${badRow} doesn't multiply out`,
    );
  },

  // [SIGNAL] VAT plausibility ≈ 7.5% (flag only — exempt items exist)
  (d) =>
    signal(
      'vat_plausibility_7_5pct',
      d.subtotalMinor === null || d.taxMinor === null || d.subtotalMinor === 0
        ? true
        : Math.abs(d.taxMinor / d.subtotalMinor - 0.075) < 0.02,
      ['taxMinor'],
      'NG VAT ≈ 7.5%',
    ),

  // [SIGNAL] subtotal not greater than total
  (d) =>
    signal(
      'subtotal_not_over_total',
      d.subtotalMinor === null || d.totalMinor === null || d.subtotalMinor <= d.totalMinor,
      ['subtotalMinor', 'totalMinor'],
    ),

  // [SIGNAL] merchant name present and non-empty
  (d) =>
    signal('merchant_name_present', d.merchantName !== null && d.merchantName.trim().length > 0, [
      'merchantName',
    ]),

  // [SIGNAL] currency resolved to ISO-4217 (NGN inferred where possible)
  (d) => signal('currency_present', d.currency !== null, ['currency'], 'could not resolve an ISO-4217 currency'),

  // [SIGNAL] total positive
  (d) => signal('total_positive', d.totalMinor === null || d.totalMinor > 0, ['totalMinor']),

  // [SIGNAL] transaction date resolved.
  // TODO(M0): promote to GATE once date-fns NG day-first parsing replaces the
  // placeholder normalizeDate (today it nulls valid dd/mm/yyyy, so GATE here
  // would over-flag every receipt).
  (d) =>
    signal('transaction_date_present', d.transactionDate !== null, ['transactionDate'], 'date unparsed (placeholder)'),
];
