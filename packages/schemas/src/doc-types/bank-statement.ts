import { z } from 'zod';
import { extractedField, CurrencyCode, IsoDate } from '../common';

/**
 * Bank statement ("hard mode", plan §6.2) — multi-row, fully reconcilable.
 * Two layers like every type: a wrapped EXTRACTION schema (Gemini self-reports
 * per field) and a normalized CANONICAL schema the reconciliation rules run on.
 */
export const BANK_STATEMENT_DOC_TYPE = 'bank_statement';

// --- 1. Extraction schema (what Gemini fills) --------------------------------

const TxExtraction = z.object({
  date: extractedField(z.string()),
  description: extractedField(z.string()),
  debit: extractedField(z.number()), // money out (NG statements often split debit/credit columns)
  credit: extractedField(z.number()), // money in
  balance: extractedField(z.number()), // running balance AFTER this row
  valueDate: extractedField(z.string()),
  reference: extractedField(z.string()),
});

export const BankStatementExtraction = z.object({
  bankName: extractedField(z.string()),
  accountName: extractedField(z.string()),
  accountNumber: extractedField(z.string()),
  statementPeriodStart: extractedField(z.string()),
  statementPeriodEnd: extractedField(z.string()),
  currency: extractedField(z.string()),
  openingBalance: extractedField(z.number()),
  closingBalance: extractedField(z.number()),
  transactions: z.array(TxExtraction),
});
export type BankStatementExtraction = z.infer<typeof BankStatementExtraction>;

// --- 2. Canonical schema (what RULES run on) ---------------------------------

const TxCanonical = z.object({
  date: IsoDate.nullable(),
  description: z.string().nullable(),
  debitMinor: z.number().int().nullable(),
  creditMinor: z.number().int().nullable(),
  balanceMinor: z.number().int().nullable(),
  valueDate: IsoDate.nullable(),
  reference: z.string().nullable(),
});

export const BankStatementCanonical = z.object({
  bankName: z.string().nullable(),
  accountName: z.string().nullable(),
  accountNumber: z.string().nullable(),
  statementPeriodStart: IsoDate.nullable(),
  statementPeriodEnd: IsoDate.nullable(),
  currency: CurrencyCode.nullable(),
  openingBalanceMinor: z.number().int().nullable(),
  closingBalanceMinor: z.number().int().nullable(),
  transactions: z.array(TxCanonical),
});
export type BankStatementCanonical = z.infer<typeof BankStatementCanonical>;

export const BANK_STATEMENT_REVIEW_FIELDS = [
  'accountNumber',
  'openingBalanceMinor',
  'closingBalanceMinor',
] as const satisfies readonly (keyof BankStatementCanonical)[];
