/** Shared normalizers used by every doc type's `normalize` (plan §6.4). */

/** Major-unit number (e.g. 1234.5) → integer minor units (kobo). */
export function toMinor(amount: number | null, exponent = 2): number | null {
  if (amount === null || Number.isNaN(amount)) return null;
  return Math.round(amount * 10 ** exponent);
}

// TODO(M0): replace with date-fns `parse` over NG day-first candidates (plan §4).
// Placeholder: keep an already-ISO prefix, else null.
export function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Map ₦ / "N" / Naira / a 3-letter code to ISO-4217; else null. Never throws. */
export function normalizeCurrency(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  if (s.includes('₦') || s === 'N' || s.startsWith('NAIRA') || s === 'NGN') return 'NGN';
  return /^[A-Z]{3}$/.test(s) ? s : null;
}
