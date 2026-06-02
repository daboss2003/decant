import { z } from 'zod';
import {
  BANK_STATEMENT_DOC_TYPE,
  BankStatementExtraction,
  BankStatementCanonical,
  BANK_STATEMENT_REVIEW_FIELDS,
} from '@decant/schemas';
import type { RegistryEntry } from '../registry';
import { toGeminiSchema } from '../gemini-schema';
import { normalizeBankStatement, bankStatementRules } from '../rules/bank-statement.rules';

/** Bank statement registry entry — "hard mode" (plan §6.2). */
export const bankStatementEntry: RegistryEntry<
  z.infer<typeof BankStatementExtraction>,
  z.infer<typeof BankStatementCanonical>
> = {
  docType: BANK_STATEMENT_DOC_TYPE,
  version: '0.1.0',
  extractionSchema: BankStatementExtraction,
  canonicalSchema: BankStatementCanonical,
  normalize: normalizeBankStatement,
  rules: bankStatementRules,
  reviewFields: BANK_STATEMENT_REVIEW_FIELDS,
  toGeminiJsonSchema: () => toGeminiSchema(z.toJSONSchema(BankStatementExtraction)),
};
