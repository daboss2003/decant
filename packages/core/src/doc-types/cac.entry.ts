import { z } from 'zod';
import { CAC_DOC_TYPE, CacExtraction, CacCanonical, CAC_REVIEW_FIELDS } from '@decant/schemas';
import type { RegistryEntry } from '../registry';
import { toGeminiSchema } from '../gemini-schema';
import { normalizeCac, cacRules } from '../rules/cac.rules';

/** CAC registry entry — Nigerian corporate registration (plan §6.3). */
export const cacEntry: RegistryEntry<z.infer<typeof CacExtraction>, z.infer<typeof CacCanonical>> = {
  docType: CAC_DOC_TYPE,
  version: '0.1.0',
  extractionSchema: CacExtraction,
  canonicalSchema: CacCanonical,
  normalize: normalizeCac,
  rules: cacRules,
  reviewFields: CAC_REVIEW_FIELDS,
  toGeminiJsonSchema: () => toGeminiSchema(z.toJSONSchema(CacExtraction)),
};
