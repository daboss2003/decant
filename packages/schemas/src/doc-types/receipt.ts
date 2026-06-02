import { z } from 'zod';
import { extractedField, CurrencyCode, IsoDate } from '../common';

/**
 * SEED TYPE — receipts / single-page invoices (plan §6.1).
 *
 * Two schema layers per registered type:
 *   1) ReceiptExtraction — given to Gemini as `responseJsonSchema`; every field
 *      is wrapped so the model self-reports {value, modelConfidence, sourceQuote}.
 *   2) ReceiptCanonical — normalized typed values (money in MINOR units, ISO
 *      dates) that the domain RULES (§6.1) run on. Normalized in @decant/core.
 */
export const RECEIPT_DOC_TYPE = 'receipt';

// --- 1. Extraction schema (what Gemini fills) --------------------------------
// Extraction fields are intentionally LOOSE strings/numbers — the regex/format
// constraints (CurrencyCode, IsoDate) live only in the canonical schema and are
// validated AFTER normalization, so the Gemini-facing schema stays compatible.

const LineItemExtraction = z.object({
  description: extractedField(z.string()),
  qty: extractedField(z.number()),
  unitPrice: extractedField(z.number()), // major units, as the model reads them
  lineTotal: extractedField(z.number()),
});

export const ReceiptExtraction = z.object({
  merchantName: extractedField(z.string()),
  merchantTaxId: extractedField(z.string()),
  transactionDate: extractedField(z.string()), // free text; normalized later
  currency: extractedField(z.string()),
  lineItems: z.array(LineItemExtraction),
  subtotal: extractedField(z.number()),
  tax: extractedField(z.number()),
  tip: extractedField(z.number()),
  discount: extractedField(z.number()),
  total: extractedField(z.number()),
  paymentMethod: extractedField(z.string()),
});
export type ReceiptExtraction = z.infer<typeof ReceiptExtraction>;

// --- 2. Canonical schema (what RULES run on) ---------------------------------

const LineItemCanonical = z.object({
  description: z.string().nullable(),
  qty: z.number().nullable(),
  unitPriceMinor: z.number().int().nullable(),
  lineTotalMinor: z.number().int().nullable(),
});

export const ReceiptCanonical = z.object({
  merchantName: z.string().nullable(),
  merchantTaxId: z.string().nullable(),
  transactionDate: IsoDate.nullable(),
  currency: CurrencyCode.nullable(),
  lineItems: z.array(LineItemCanonical),
  subtotalMinor: z.number().int().nullable(),
  taxMinor: z.number().int().nullable(),
  tipMinor: z.number().int().nullable(),
  discountMinor: z.number().int().nullable(),
  totalMinor: z.number().int().nullable(),
  paymentMethod: z.string().nullable(),
});
export type ReceiptCanonical = z.infer<typeof ReceiptCanonical>;

/**
 * Canonical fields a human may correct via MCP elicitation / the review UI.
 * Typed against `keyof ReceiptCanonical` so a field rename breaks the build.
 */
export const RECEIPT_REVIEW_FIELDS = [
  'merchantName',
  'transactionDate',
  'currency',
  'subtotalMinor',
  'taxMinor',
  'totalMinor',
] as const satisfies readonly (keyof ReceiptCanonical)[];
