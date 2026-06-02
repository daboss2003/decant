import { resolve } from 'node:path';
import sharp from 'sharp';

/**
 * Generate a synthetic receipt PNG that RECONCILES (subtotal + VAT = total),
 * so a correct extraction should pass every GATE → all fields auto-approve.
 * Lets us exercise the real Gemini path without sourcing a private document.
 *
 * Usage: tsx src/gen-sample.ts [outPath] [totalText]
 * Pass a non-reconciling total (e.g. "9,999.00") to demo safe-failure.
 */
const total = process.argv[3] ?? '1,075.00';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="360">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <g font-family="monospace" fill="#111111">
    <text x="28" y="48" font-size="26" font-weight="bold">CAFE NEABLE</text>
    <text x="28" y="84" font-size="16">Lagos, Nigeria</text>
    <text x="28" y="116" font-size="16">Date: 2026-05-01</text>
    <line x1="28" y1="132" x2="492" y2="132" stroke="#999"/>
    <text x="28" y="166" font-size="16">2 x Tea @ 500            1,000.00</text>
    <line x1="28" y1="184" x2="492" y2="184" stroke="#999"/>
    <text x="28" y="218" font-size="16">Subtotal                 1,000.00</text>
    <text x="28" y="248" font-size="16">VAT (7.5%)                  75.00</text>
    <text x="28" y="284" font-size="20" font-weight="bold">TOTAL                    ${total}</text>
    <text x="28" y="324" font-size="16">Paid: Cash      Currency: NGN</text>
  </g>
</svg>`;

const out = resolve(process.argv[2] ?? 'sample-receipt.png');
await sharp(Buffer.from(svg)).png().toFile(out);
console.log(`wrote ${out}`);
