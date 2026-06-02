import type { GoldDoc } from './evaluate';

/**
 * Synthetic gold set (plan §4) — reproducible and PII-free. Each entry is the
 * GROUND TRUTH of a receipt; the eval CLI renders an image from these values,
 * runs the real pipeline, and scores the extraction against them.
 *
 * Keep adding entries (and real, redacted docs later) — a meaningful reliability
 * diagram needs ~100+ field instances.
 */
export const RECEIPT_GOLD: GoldDoc[] = [
  {
    id: 'receipt-001',
    docType: 'receipt',
    fields: {
      merchantName: { kind: 'string', expected: 'CAFE NEABLE' },
      transactionDate: { kind: 'date', expected: '2026-05-01' },
      currency: { kind: 'currency', expected: 'NGN' },
      subtotal: { kind: 'money', expected: 1000 },
      tax: { kind: 'money', expected: 75 },
      total: { kind: 'money', expected: 1075 },
    },
  },
  {
    id: 'receipt-002',
    docType: 'receipt',
    fields: {
      merchantName: { kind: 'string', expected: 'SHOPRITE LEKKI' },
      transactionDate: { kind: 'date', expected: '2026-03-04' }, // printed 04/03/2026 (day-first)
      currency: { kind: 'currency', expected: 'NGN' },
      subtotal: { kind: 'money', expected: 20000 },
      tax: { kind: 'money', expected: 1500 },
      total: { kind: 'money', expected: 21500 },
    },
  },
  {
    id: 'receipt-003',
    docType: 'receipt',
    fields: {
      merchantName: { kind: 'string', expected: 'MAMA PUT KITCHEN' },
      transactionDate: { kind: 'date', expected: '2026-01-15' },
      currency: { kind: 'currency', expected: 'NGN' },
      subtotal: { kind: 'money', expected: 4500 },
      tax: { kind: 'money', expected: 337.5 },
      total: { kind: 'money', expected: 4837.5 },
    },
  },
];
