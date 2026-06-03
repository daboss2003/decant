import type { GoldDoc } from './evaluate';

/**
 * Deterministic synthetic gold-set generator (plan §4). Produces a larger, varied,
 * PII-free labeled set across the three registered doc types so the reliability
 * diagram has enough field instances to be statistically meaningful — and a
 * per-type breakdown. Values are the GROUND TRUTH; the eval CLI renders an image
 * from them (degrading it per `difficulty`) and scores the real pipeline against
 * the labels.
 *
 * `difficulty` is a RENDERING hint only (ignored by scoring). It exists to spread
 * the model's confidence: a clean scan is usually read correctly at high
 * confidence, a degraded one is sometimes misread — that spread is what makes a
 * reliability/ECE curve informative rather than a single point.
 */
export type Difficulty = 'clean' | 'noisy' | 'hard';

export interface GeneratedGoldDoc extends GoldDoc {
  difficulty: Difficulty;
}

export interface GenerateOptions {
  seed?: number;
  receipts?: number;
  bankStatements?: number;
  cac?: number;
}

/** Small, fast, seeded PRNG so the whole set is reproducible from a seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;
const int = (rng: Rng, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));
const money = (rng: Rng, lo: number, hi: number): number => Math.round((lo + rng() * (hi - lo)) * 100) / 100;
const iso = (y: number, m: number, d: number): string => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const randDate = (rng: Rng): string => iso(pick(rng, [2024, 2025, 2026]), int(rng, 1, 12), int(rng, 1, 28));

// ~50% clean / ~33% noisy / ~17% hard.
const DIFFICULTIES: readonly Difficulty[] = ['clean', 'clean', 'clean', 'noisy', 'noisy', 'hard'];

const MERCHANTS = ['CAFE NEABLE', 'SHOPRITE LEKKI', 'MAMA PUT KITCHEN', 'JUMIA FOOD', 'EBEANO SUPERMARKET', 'CHICKEN REPUBLIC', 'SPAR VICTORIA ISLAND', 'KONGA STORE', 'THE PALMS MALL', 'GENESIS DELUXE'];
const CURRENCIES = ['NGN', 'NGN', 'NGN', 'USD', 'GHS'] as const; // NGN-weighted
const BANKS = ['Guaranty Trust Bank', 'Access Bank', 'Zenith Bank', 'First Bank of Nigeria', 'United Bank for Africa', 'Kuda Microfinance Bank'];
const PERSON_NAMES = ['Adeola Okafor', 'Chidi Eze', 'Funmilayo Bello', 'Ibrahim Sani', 'Ngozi Obi', 'Tunde Adeyemi'];
const COMPANIES = ['Acme Nigeria Limited', 'Globex Foods Plc', 'Initech Systems Ltd', 'Sahara Logistics Limited', 'Banex Technologies Ltd', 'Naija Agro Holdings Plc'];
const ENTITY_TYPES = ['PRIVATE LIMITED', 'PUBLIC LIMITED', 'BUSINESS NAME'];

function genReceipt(rng: Rng, i: number): GeneratedGoldDoc {
  const currency = pick(rng, CURRENCIES);
  const subtotal = money(rng, 500, 80_000);
  const tax = Math.round(subtotal * 0.075 * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;
  return {
    id: `receipt-gen-${String(i + 1).padStart(3, '0')}`,
    docType: 'receipt',
    difficulty: pick(rng, DIFFICULTIES),
    fields: {
      merchantName: { kind: 'string', expected: pick(rng, MERCHANTS) },
      transactionDate: { kind: 'date', expected: randDate(rng) },
      currency: { kind: 'currency', expected: currency },
      subtotal: { kind: 'money', expected: subtotal },
      tax: { kind: 'money', expected: tax },
      total: { kind: 'money', expected: total },
    },
  };
}

function genBankStatement(rng: Rng, i: number): GeneratedGoldDoc {
  const opening = money(rng, 10_000, 500_000);
  const net = money(rng, -200_000, 400_000);
  const closing = Math.round((opening + net) * 100) / 100;
  const y = pick(rng, [2025, 2026]);
  const m = int(rng, 1, 11);
  return {
    id: `bank-gen-${String(i + 1).padStart(3, '0')}`,
    docType: 'bank_statement',
    difficulty: pick(rng, DIFFICULTIES),
    fields: {
      bankName: { kind: 'string', expected: pick(rng, BANKS) },
      accountNumber: { kind: 'id', expected: String(int(rng, 1_000_000_000, 9_999_999_999)) },
      currency: { kind: 'currency', expected: 'NGN' },
      statementPeriodStart: { kind: 'date', expected: iso(y, m, 1) },
      statementPeriodEnd: { kind: 'date', expected: iso(y, m, 28) },
      openingBalance: { kind: 'money', expected: opening },
      closingBalance: { kind: 'money', expected: closing },
    },
  };
}

function genCac(rng: Rng, i: number): GeneratedGoldDoc {
  const authorized = pick(rng, [1_000_000, 2_000_000, 5_000_000, 10_000_000]);
  const issued = Math.round(authorized * pick(rng, [0.5, 0.75, 1]));
  return {
    id: `cac-gen-${String(i + 1).padStart(3, '0')}`,
    docType: 'cac',
    difficulty: pick(rng, DIFFICULTIES),
    fields: {
      rcNumber: { kind: 'id', expected: `RC${int(rng, 100_000, 9_999_999)}` },
      companyName: { kind: 'string', expected: pick(rng, COMPANIES) },
      entityType: { kind: 'string', expected: pick(rng, ENTITY_TYPES) },
      registrationDate: { kind: 'date', expected: randDate(rng) },
      currency: { kind: 'currency', expected: 'NGN' },
      authorizedCapital: { kind: 'money', expected: authorized },
      issuedCapital: { kind: 'money', expected: issued },
    },
  };
}

export function generateGoldSet(opts: GenerateOptions = {}): GeneratedGoldDoc[] {
  const rng = mulberry32(opts.seed ?? 42);
  const docs: GeneratedGoldDoc[] = [];
  for (let i = 0; i < (opts.receipts ?? 24); i++) docs.push(genReceipt(rng, i));
  for (let i = 0; i < (opts.bankStatements ?? 12); i++) docs.push(genBankStatement(rng, i));
  for (let i = 0; i < (opts.cac ?? 12); i++) docs.push(genCac(rng, i));
  return docs;
}
