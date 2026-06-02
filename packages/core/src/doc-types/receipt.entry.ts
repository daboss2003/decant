import { z } from 'zod';
import {
  RECEIPT_DOC_TYPE,
  ReceiptExtraction,
  ReceiptCanonical,
  RECEIPT_REVIEW_FIELDS,
} from '@decant/schemas';
import type { RegistryEntry } from '../registry';
import { toGeminiSchema } from '../gemini-schema';
import { normalizeReceipt, receiptRules } from '../rules/receipt.rules';

/** The receipt/invoice registry entry — the seed type (plan §6.1). */
export const receiptEntry: RegistryEntry<
  z.infer<typeof ReceiptExtraction>,
  z.infer<typeof ReceiptCanonical>
> = {
  docType: RECEIPT_DOC_TYPE,
  version: '0.1.0',
  extractionSchema: ReceiptExtraction,
  canonicalSchema: ReceiptCanonical,
  normalize: normalizeReceipt,
  rules: receiptRules,
  reviewFields: RECEIPT_REVIEW_FIELDS,
  // Gemini accepts JSON Schema but wants `nullable:true` (not anyOf-null) and
  // rejects some keywords — `toGeminiSchema` translates/strips them (§5/§6).
  // (If extraction fields ever gain .default()/transform, pass { io: 'input' }.)
  toGeminiJsonSchema: () => toGeminiSchema(z.toJSONSchema(ReceiptExtraction)),
};
