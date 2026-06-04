import sharp from 'sharp';
import type { GoldDoc, Difficulty } from '@decant/eval';

/**
 * Render a gold record (ground truth) into a printed-document image, per doc type,
 * then DEGRADE it according to `difficulty` so the vision model's confidence
 * varies — a clean scan reads correctly, a faded/blurred phone photo sometimes
 * doesn't. That spread is what makes the reliability/ECE curve informative.
 */

const fmtMoney = (n: number): string => n.toLocaleString('en-US', { minimumFractionDigits: 2 });
const isoToDayFirst = (isoDate: string): string => {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`; // NG day-first, to exercise the date parser
};
const str = (g: GoldDoc, k: string): string => String(g.fields[k]?.expected ?? '');
const num = (g: GoldDoc, k: string): number => Number(g.fields[k]?.expected ?? 0);

function receiptSvg(g: GoldDoc): string {
  const cur = str(g, 'currency');
  const subtotal = num(g, 'subtotal');
  const tax = num(g, 'tax');
  const total = num(g, 'total');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="360">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <g font-family="monospace" fill="#111111">
      <text x="28" y="48" font-size="24" font-weight="bold">${str(g, 'merchantName')}</text>
      <text x="28" y="86" font-size="16">Date: ${isoToDayFirst(str(g, 'transactionDate'))}</text>
      <line x1="28" y1="104" x2="492" y2="104" stroke="#999"/>
      <text x="28" y="140" font-size="16">1 x Item            ${fmtMoney(subtotal)}</text>
      <line x1="28" y1="158" x2="492" y2="158" stroke="#999"/>
      <text x="28" y="196" font-size="16">Subtotal            ${fmtMoney(subtotal)}</text>
      <text x="28" y="226" font-size="16">VAT                 ${fmtMoney(tax)}</text>
      <text x="28" y="262" font-size="20" font-weight="bold">TOTAL               ${fmtMoney(total)}</text>
      <text x="28" y="300" font-size="16">Currency: ${cur}   Paid: Cash</text>
    </g>
  </svg>`;
}

function bankStatementSvg(g: GoldDoc): string {
  const cur = str(g, 'currency');
  const opening = num(g, 'openingBalance');
  const closing = num(g, 'closingBalance');
  const net = Math.round((closing - opening) * 100) / 100;
  // Two illustrative rows that walk opening → closing (not gold-scored; for realism).
  const half = Math.round((net / 2) * 100) / 100;
  const r1 = Math.round((opening + half) * 100) / 100;
  const row = (date: string, desc: string, amt: number, bal: number, credit: boolean): string =>
    `<text x="28" y="0" font-size="13">${date}  ${desc.padEnd(20).slice(0, 20)}  ${credit ? '' : '-'}${fmtMoney(Math.abs(amt))}   ${fmtMoney(bal)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <g font-family="monospace" fill="#111111">
      <text x="28" y="40" font-size="22" font-weight="bold">${str(g, 'bankName')}</text>
      <text x="28" y="68" font-size="14">Account Statement (${cur})</text>
      <text x="28" y="90" font-size="14">Account No: ${str(g, 'accountNumber')}</text>
      <text x="28" y="112" font-size="14">Period: ${isoToDayFirst(str(g, 'statementPeriodStart'))} to ${isoToDayFirst(str(g, 'statementPeriodEnd'))}</text>
      <line x1="28" y1="126" x2="612" y2="126" stroke="#999"/>
      <text x="28" y="150" font-size="14">Opening Balance                          ${fmtMoney(opening)}</text>
      <g transform="translate(0,182)">${row(isoToDayFirst(str(g, 'statementPeriodStart')), 'TRANSFER', half, r1, half >= 0)}</g>
      <g transform="translate(0,206)">${row(isoToDayFirst(str(g, 'statementPeriodEnd')), 'TRANSFER', net - half, closing, net - half >= 0)}</g>
      <line x1="28" y1="226" x2="612" y2="226" stroke="#999"/>
      <text x="28" y="252" font-size="14" font-weight="bold">Closing Balance                          ${fmtMoney(closing)}</text>
    </g>
  </svg>`;
}

function cacSvg(g: GoldDoc): string {
  const cur = str(g, 'currency');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <rect x="12" y="12" width="616" height="396" fill="none" stroke="#444" stroke-width="2"/>
    <g font-family="serif" fill="#111111">
      <text x="320" y="56" font-size="18" font-weight="bold" text-anchor="middle">CORPORATE AFFAIRS COMMISSION</text>
      <text x="320" y="82" font-size="14" text-anchor="middle">Certificate of Incorporation</text>
      <line x1="40" y1="100" x2="600" y2="100" stroke="#999"/>
      <g font-family="monospace" font-size="15">
        <text x="48" y="140">RC Number:        ${str(g, 'rcNumber')}</text>
        <text x="48" y="172">Company Name:     ${str(g, 'companyName')}</text>
        <text x="48" y="204">Entity Type:      ${str(g, 'entityType')}</text>
        <text x="48" y="236">Date Registered:  ${isoToDayFirst(str(g, 'registrationDate'))}</text>
        <text x="48" y="268">Currency:         ${cur}</text>
        <text x="48" y="300">Authorized Capital: ${cur} ${fmtMoney(num(g, 'authorizedCapital'))}</text>
        <text x="48" y="332">Issued Capital:     ${cur} ${fmtMoney(num(g, 'issuedCapital'))}</text>
      </g>
    </g>
  </svg>`;
}

async function degrade(svg: string, difficulty: Difficulty): Promise<{ buffer: Buffer; ext: 'png' | 'jpg' }> {
  const base = (): sharp.Sharp => sharp(Buffer.from(svg));
  if (difficulty === 'clean') return { buffer: await base().png().toBuffer(), ext: 'png' };
  if (difficulty === 'noisy') {
    return { buffer: await base().blur(0.5).modulate({ brightness: 0.96 }).jpeg({ quality: 45 }).toBuffer(), ext: 'jpg' };
  }
  // hard: faded, slightly rotated, low-quality phone photo
  return {
    buffer: await base()
      .flatten({ background: '#ffffff' })
      .rotate(2, { background: '#ffffff' })
      .blur(1.0)
      .modulate({ brightness: 0.85 })
      .linear(0.85, 10)
      .jpeg({ quality: 25 })
      .toBuffer(),
    ext: 'jpg',
  };
}

/** Render + degrade a gold record into an image buffer (dispatch by doc type). */
export async function renderGold(g: GoldDoc & { difficulty?: Difficulty }): Promise<{ buffer: Buffer; ext: 'png' | 'jpg' }> {
  const svg = g.docType === 'bank_statement' ? bankStatementSvg(g) : g.docType === 'cac' ? cacSvg(g) : receiptSvg(g);
  return degrade(svg, g.difficulty ?? 'clean');
}
