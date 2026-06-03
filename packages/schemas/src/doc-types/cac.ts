import { z } from 'zod';
import { extractedField, CurrencyCode, IsoDate } from '../common';

/**
 * CAC document — Nigerian corporate registration (plan §6.3). Rigid expected
 * fields → format/regex rules dominate; the one piece of cross-field math is
 * Σ(shareholder shares) == issued shares.
 */
export const CAC_DOC_TYPE = 'cac';

// --- 1. Extraction schema (what Gemini fills) --------------------------------

const DirectorExtraction = z.object({
  name: extractedField(z.string()),
  address: extractedField(z.string()),
  nationality: extractedField(z.string()),
  sharesHeld: extractedField(z.number()),
});

const ShareholderExtraction = z.object({
  name: extractedField(z.string()),
  numShares: extractedField(z.number()),
  shareValue: extractedField(z.number()),
});

export const CacExtraction = z.object({
  rcNumber: extractedField(z.string()),
  companyName: extractedField(z.string()),
  entityType: extractedField(z.string()),
  registrationDate: extractedField(z.string()),
  registeredAddress: extractedField(z.string()),
  currency: extractedField(z.string()),
  authorizedCapital: extractedField(z.number()),
  issuedCapital: extractedField(z.number()),
  issuedShares: extractedField(z.number()),
  natureOfBusiness: extractedField(z.string()),
  status: extractedField(z.string()),
  directors: z.array(DirectorExtraction),
  shareholders: z.array(ShareholderExtraction),
});
export type CacExtraction = z.infer<typeof CacExtraction>;

// --- 2. Canonical schema (what RULES run on) ---------------------------------

const DirectorCanonical = z.object({
  name: z.string().nullable(),
  address: z.string().nullable(),
  nationality: z.string().nullable(),
  sharesHeld: z.number().nullable(),
});

const ShareholderCanonical = z.object({
  name: z.string().nullable(),
  numShares: z.number().nullable(),
  shareValueMinor: z.number().int().nullable(),
});

export const CacCanonical = z.object({
  rcNumber: z.string().nullable(),
  companyName: z.string().nullable(),
  entityType: z.string().nullable(),
  registrationDate: IsoDate.nullable(),
  registeredAddress: z.string().nullable(),
  currency: CurrencyCode.nullable(),
  authorizedCapitalMinor: z.number().int().nullable(),
  issuedCapitalMinor: z.number().int().nullable(),
  issuedShares: z.number().nullable(),
  natureOfBusiness: z.string().nullable(),
  status: z.string().nullable(),
  directors: z.array(DirectorCanonical),
  shareholders: z.array(ShareholderCanonical),
});
export type CacCanonical = z.infer<typeof CacCanonical>;

/** Known CAC entity types (suffix/consistency checks). */
export const CAC_ENTITY_TYPES = ['LTD', 'PLC', 'BUSINESS NAME', 'INCORPORATED TRUSTEE', 'LLP'] as const;

export const CAC_REVIEW_FIELDS = [
  'rcNumber',
  'companyName',
  'registrationDate',
  'entityType',
  'issuedCapitalMinor',
] as const satisfies readonly (keyof CacCanonical)[];
