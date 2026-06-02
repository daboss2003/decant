import type { ReceiptCanonical, ReceiptExtraction } from '@decant/schemas';
import type { DomainRule } from '../registry';
import { toMinor, normalizeDate, normalizeCurrency } from './normalize';
import { eqWithin, gate, signal } from './rule-helpers';

/**
 * Receipt / invoice normalization + domain rules (plan §6.1).
 * Fail-safe (plan §3): a MISSING required value never silently passes — it routes
 * to review; normalization never throws (bad values become null and get flagged).
 */

/** Map raw Gemini extraction → canonical (money in minor units, ISO dates). */
export function normalizeReceipt(x: ReceiptExtraction): ReceiptCanonical {
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

  // [GATE] subtotal + tax + tip − discount == total (null total handled above)
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
      badRow === -1 ? ['lineItems'] : [`lineItems.${badRow}.lineTotal`],
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

  // [SIGNAL] merchant name present
  (d) =>
    signal('merchant_name_present', d.merchantName !== null && d.merchantName.trim().length > 0, ['merchantName']),

  // [SIGNAL] currency resolved to ISO-4217 (NGN inferred where possible)
  (d) => signal('currency_present', d.currency !== null, ['currency'], 'could not resolve an ISO-4217 currency'),

  // [SIGNAL] total positive
  (d) => signal('total_positive', d.totalMinor === null || d.totalMinor > 0, ['totalMinor']),

  // [GATE] transaction date present + parseable (date-fns NG day-first, §4).
  (d) =>
    gate('transaction_date_present', d.transactionDate !== null, ['transactionDate'], 'date missing or unparseable → review'),
];
