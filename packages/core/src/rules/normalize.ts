/** Shared normalizers used by every doc type's `normalize` (plan §6.4). */
import { parse, isValid, format } from 'date-fns';

/** Major-unit number (e.g. 1234.5) → integer minor units (kobo). */
export function toMinor(amount: number | null, exponent = 2): number | null {
  if (amount === null || Number.isNaN(amount)) return null;
  return Math.round(amount * 10 ** exponent);
}

// Candidate formats tried in order. Ambiguous numeric dates are DAY-FIRST
// (Nigerian convention, plan §4/§6.4): "03/04/2026" → 3 April, not 4 March.
const DATE_FORMATS = [
  'yyyy-MM-dd', // ISO (and what we emit)
  'dd/MM/yyyy',
  'dd-MM-yyyy',
  'dd.MM.yyyy',
  'd/M/yyyy',
  'dd/MM/yy',
  'dd MMM yyyy', // 03 Apr 2026
  'dd MMMM yyyy', // 03 April 2026
  'MMM dd, yyyy', // Apr 03, 2026
  'MMMM dd, yyyy',
];

// Constant reference date — all formats carry full y/m/d, so it never affects the result.
const REFERENCE = new Date(2000, 0, 1);

/** Parse a free-text date (NG day-first) to canonical ISO yyyy-MM-dd, else null. Never throws. */
export function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  for (const fmt of DATE_FORMATS) {
    const d = parse(s, fmt, REFERENCE);
    if (isValid(d)) return format(d, 'yyyy-MM-dd');
  }
  return null;
}

/** Map ₦ / "N" / Naira / a 3-letter code to ISO-4217; else null. Never throws. */
export function normalizeCurrency(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  if (s.includes('₦') || s === 'N' || s.startsWith('NAIRA') || s === 'NGN') return 'NGN';
  return /^[A-Z]{3}$/.test(s) ? s : null;
}
