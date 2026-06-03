import { CAC_ENTITY_TYPES, type CacCanonical, type CacExtraction } from '@decant/schemas';
import type { DomainRule } from '../registry';
import { toMinor, normalizeDate, normalizeCurrency } from './normalize';
import { gate, signal } from './rule-helpers';

/**
 * CAC normalization + domain rules (plan §6.3). Rigid format/regex rules carry
 * most of the weight; Σ(shareholder shares) == issued shares is the one strong
 * cross-field check.
 */
const RC_NUMBER_RE = /^(RC|BN|IT|LL|LLP)?\d{4,8}$/;

function normalizeRc(raw: string | null): string | null {
  if (!raw) return null;
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function normalizeCac(x: CacExtraction): CacCanonical {
  const directors = Array.isArray(x?.directors) ? x.directors : [];
  const shareholders = Array.isArray(x?.shareholders) ? x.shareholders : [];
  return {
    rcNumber: normalizeRc(x?.rcNumber?.value ?? null),
    companyName: x?.companyName?.value ?? null,
    entityType: x?.entityType?.value ? x.entityType.value.trim().toUpperCase() : null,
    registrationDate: normalizeDate(x?.registrationDate?.value ?? null),
    registeredAddress: x?.registeredAddress?.value ?? null,
    currency: normalizeCurrency(x?.currency?.value ?? null),
    authorizedCapitalMinor: toMinor(x?.authorizedCapital?.value ?? null),
    issuedCapitalMinor: toMinor(x?.issuedCapital?.value ?? null),
    issuedShares: x?.issuedShares?.value ?? null,
    natureOfBusiness: x?.natureOfBusiness?.value ?? null,
    status: x?.status?.value ?? null,
    directors: directors.map((d) => ({
      name: d?.name?.value ?? null,
      address: d?.address?.value ?? null,
      nationality: d?.nationality?.value ?? null,
      sharesHeld: d?.sharesHeld?.value ?? null,
    })),
    shareholders: shareholders.map((s) => ({
      name: s?.name?.value ?? null,
      numShares: s?.numShares?.value ?? null,
      shareValueMinor: toMinor(s?.shareValue?.value ?? null),
    })),
  };
}

export const cacRules: DomainRule<CacCanonical>[] = [
  // [GATE] RC number present and well-formed (the document's primary key).
  (d) =>
    gate(
      'rc_number_valid',
      d.rcNumber !== null && RC_NUMBER_RE.test(d.rcNumber),
      ['rcNumber'],
      d.rcNumber ? `"${d.rcNumber}" doesn't match the RC-number format` : 'RC number missing',
    ),

  // [GATE] company name present.
  (d) => gate('company_name_present', d.companyName !== null && d.companyName.trim().length > 0, ['companyName']),

  // [GATE] registration date present + parseable.
  (d) => gate('registration_date_present', d.registrationDate !== null, ['registrationDate']),

  // [GATE] issued capital not greater than authorized.
  (d) =>
    gate(
      'issued_not_over_authorized',
      d.authorizedCapitalMinor === null ||
        d.issuedCapitalMinor === null ||
        d.issuedCapitalMinor <= d.authorizedCapitalMinor,
      ['issuedCapitalMinor', 'authorizedCapitalMinor'],
    ),

  // [SIGNAL] Σ(shareholder shares) == issued shares (the cross-field math, when present).
  (d) => {
    if (d.issuedShares === null || d.shareholders.length === 0)
      return signal('shareholders_sum_to_issued_shares', true, ['shareholders', 'issuedShares'], 'no share table — skipped');
    const sum = d.shareholders.reduce((s, h) => s + (h.numShares ?? 0), 0);
    return signal('shareholders_sum_to_issued_shares', sum === d.issuedShares, ['shareholders', 'issuedShares'], `Σ shares=${sum} vs issued=${d.issuedShares}`);
  },

  // [SIGNAL] registration date in a plausible range (1960–2100).
  (d) => {
    const year = d.registrationDate ? Number(d.registrationDate.slice(0, 4)) : null;
    return signal('registration_date_plausible', year === null || (year >= 1960 && year <= 2100), ['registrationDate']);
  },

  // [SIGNAL] entity type is one of the known CAC categories.
  (d) =>
    signal(
      'entity_type_known',
      d.entityType === null || CAC_ENTITY_TYPES.some((t) => d.entityType!.includes(t)),
      ['entityType'],
    ),

  // [SIGNAL] at least one director/proprietor present.
  (d) => signal('directors_present', d.directors.length >= 1, ['directors']),
];
