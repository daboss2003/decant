/**
 * Test fixtures — wrapped-extraction builders. NOT exported from the package
 * index (test-only). Shapes mirror `@decant/schemas` ReceiptExtraction so
 * `entry.normalize` and the rules run on them.
 */
export const ef = <T>(value: T, modelConfidence = 0.95) => ({
  value,
  modelConfidence,
  sourceQuote: value === null ? null : String(value),
});

export interface ReceiptRawOpts {
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  tip?: number;
  discount?: number;
  lines: Array<{ qty: number; unit: number; lineTotal: number }>;
  merchant?: string;
  date?: string;
  currency?: string;
}

export function receiptRaw(o: ReceiptRawOpts) {
  return {
    merchantName: ef(o.merchant ?? 'Shoprite'),
    merchantTaxId: ef<string | null>(null),
    transactionDate: ef(o.date ?? '2026-05-01'),
    currency: ef(o.currency ?? 'NGN'),
    lineItems: o.lines.map((l) => ({
      description: ef('item'),
      qty: ef(l.qty),
      unitPrice: ef(l.unit),
      lineTotal: ef(l.lineTotal),
    })),
    subtotal: ef(o.subtotal),
    tax: ef(o.tax),
    tip: ef(o.tip ?? 0),
    discount: ef(o.discount ?? 0),
    total: ef(o.total),
    paymentMethod: ef('cash'),
  };
}
