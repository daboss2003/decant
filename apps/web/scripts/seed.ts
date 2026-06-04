import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { createPrismaClient, savePipelineResult } from '@decant/db';
import type { PipelineResult } from '@decant/core';

const url = process.env.DATABASE_URL ?? `file:${resolve(process.cwd(), '../../packages/db/prisma/dev.db')}`;
const prisma = createPrismaClient(url);

// A receipt where the printed TOTAL (9,999) does not reconcile with
// subtotal (1,000) + VAT (75) — so the money fields are flagged for review.
const result: PipelineResult = {
  uploadId: 'seed',
  documents: [
    {
      documentId: 'seed-doc',
      docType: 'receipt',
      mode: 'typed',
      pageRange: [0, 0],
      reclassify: false,
      ruleResults: [],
      // bboxes are fractions of the 520x340 scan below — measured by running the
      // real Tesseract OcrProvider over this exact image (so the overlay is true).
      fields: [
        { fieldPath: 'merchantName', value: 'CAFE NEABLE', confidence: 0.97, status: 'auto_approved', signals: {},
          provenance: { pageIndex: 0, bbox: { x: 0.058, y: 0.082, w: 0.298, h: 0.053 } } },
        { fieldPath: 'transactionDate', value: '2026-05-01', confidence: 0.95, status: 'auto_approved', signals: {},
          provenance: { pageIndex: 0, bbox: { x: 0.167, y: 0.206, w: 0.181, h: 0.041 } } },
        { fieldPath: 'currency', value: 'NGN', confidence: 0.93, status: 'auto_approved', signals: {} },
        { fieldPath: 'subtotal', value: 1000, confidence: 0.15, status: 'needs_review', signals: { gateFailed: true },
          provenance: { pageIndex: 0, bbox: { x: 0.223, y: 0.365, w: 0.144, h: 0.044 } } },
        { fieldPath: 'tax', value: 75, confidence: 0.15, status: 'needs_review', signals: { gateFailed: true },
          provenance: { pageIndex: 0, bbox: { x: 0.26, y: 0.453, w: 0.088, h: 0.035 } } },
        { fieldPath: 'total', value: 9999, confidence: 0.15, status: 'needs_review', signals: { gateFailed: true },
          provenance: { pageIndex: 0, bbox: { x: 0.194, y: 0.562, w: 0.181, h: 0.053 } } },
      ],
      // MCP client role: FX-converted total via an external FX server.
      enrichments: [
        { kind: 'fx', field: 'total', amount: 9999, currency: 'NGN', base: 'USD', baseAmount: 6.5, rate: 0.00065, asOf: '2026-05-01' },
      ],
    },
  ],
};

// A CAC document whose extracted company name does NOT match the company registry
// for its RC number — the registry verification (MCP client) routes companyName to
// review: an external-source safe failure even though the model was confident.
const cacResult: PipelineResult = {
  uploadId: 'seed-cac',
  documents: [
    {
      documentId: 'seed-cac-doc',
      docType: 'cac',
      mode: 'typed',
      pageRange: [0, 0],
      reclassify: false,
      ruleResults: [],
      fields: [
        { fieldPath: 'rcNumber', value: 'RC123456', confidence: 0.96, status: 'auto_approved', signals: {} },
        { fieldPath: 'companyName', value: 'Zenith Holdings', confidence: 0.94, status: 'needs_review', signals: { registryMismatch: true } },
        { fieldPath: 'registrationDate', value: '2019-03-12', confidence: 0.95, status: 'auto_approved', signals: {} },
      ],
      enrichments: [
        { kind: 'verification', verifier: 'registry', field: 'companyName', extractedValue: 'Zenith Holdings', authoritativeValue: 'Acme Nigeria Limited', matchScore: 0.07, status: 'mismatch', source: 'demo' },
      ],
    },
  ],
};

// A 2-page bank statement — demonstrates multi-page review (page navigation +
// per-page bbox overlays). Fields carry provenance on page 0 AND page 1.
const bankResult: PipelineResult = {
  uploadId: 'seed-bank',
  documents: [
    {
      documentId: 'seed-bank-doc',
      docType: 'bank_statement',
      mode: 'typed',
      pageRange: [0, 1],
      reclassify: false,
      ruleResults: [],
      fields: [
        { fieldPath: 'bankName', value: 'Guaranty Trust Bank', confidence: 0.97, status: 'auto_approved', signals: {},
          provenance: { pageIndex: 0, bbox: { x: 0.05, y: 0.075, w: 0.55, h: 0.07 } } },
        { fieldPath: 'accountNumber', value: '0123456789', confidence: 0.95, status: 'auto_approved', signals: {},
          provenance: { pageIndex: 0, bbox: { x: 0.05, y: 0.2, w: 0.42, h: 0.05 } } },
        { fieldPath: 'openingBalance', value: 50000, confidence: 0.94, status: 'auto_approved', signals: {},
          provenance: { pageIndex: 0, bbox: { x: 0.05, y: 0.41, w: 0.5, h: 0.05 } } },
        { fieldPath: 'closingBalance', value: 73500, confidence: 0.15, status: 'needs_review', signals: { gateFailed: true },
          provenance: { pageIndex: 1, bbox: { x: 0.05, y: 0.53, w: 0.5, h: 0.06 } } },
        { fieldPath: 'currency', value: 'NGN', confidence: 0.93, status: 'auto_approved', signals: {},
          provenance: { pageIndex: 1, bbox: { x: 0.05, y: 0.64, w: 0.3, h: 0.05 } } },
      ],
    },
  ],
};

const bankPage = (n: 1 | 2, lines: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="360">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <g font-family="monospace" fill="#111111">
    <text x="28" y="46" font-size="22" font-weight="bold">Guaranty Trust Bank</text>
    <text x="360" y="46" font-size="13">Page ${n} of 2</text>
    <line x1="28" y1="60" x2="492" y2="60" stroke="#999"/>${lines}
  </g>
</svg>`;
const bankSvg0 = bankPage(1, `
    <text x="28" y="86" font-size="15">Account No: 0123456789</text>
    <text x="28" y="120" font-size="14">Period: 01/04/2026 to 30/04/2026   Currency: NGN</text>
    <text x="28" y="160" font-size="16">Opening Balance            50,000.00</text>
    <text x="28" y="200" font-size="13">03/04 POS PURCHASE     -5,000.00   45,000.00</text>
    <text x="28" y="224" font-size="13">12/04 TRANSFER IN     +30,000.00   75,000.00</text>`);
const bankSvg1 = bankPage(2, `
    <text x="28" y="120" font-size="13">28/04 BANK CHARGES     -1,500.00   73,500.00</text>
    <line x1="28" y1="180" x2="492" y2="180" stroke="#999"/>
    <text x="28" y="206" font-size="16" font-weight="bold">Closing Balance            73,500.00</text>
    <text x="28" y="246" font-size="15">Currency: NGN</text>`);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="340">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <g font-family="monospace" fill="#111111">
    <text x="28" y="46" font-size="24" font-weight="bold">CAFE NEABLE</text>
    <text x="28" y="82" font-size="16">Date: 01/05/2026</text>
    <line x1="28" y1="100" x2="492" y2="100" stroke="#999"/>
    <text x="28" y="136" font-size="16">Subtotal            1,000.00</text>
    <text x="28" y="166" font-size="16">VAT (7.5%)             75.00</text>
    <text x="28" y="206" font-size="20" font-weight="bold">TOTAL               9,999.00</text>
    <text x="28" y="246" font-size="16">Currency: NGN   Paid: Cash</text>
  </g>
</svg>`;

async function main(): Promise<void> {
  const uploadsDir = resolve(process.cwd(), 'public/uploads');
  mkdirSync(uploadsDir, { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(resolve(uploadsDir, 'seed-receipt.png'));
  await sharp(Buffer.from(bankSvg0)).png().toFile(resolve(uploadsDir, 'seed-bank-0.png'));
  await sharp(Buffer.from(bankSvg1)).png().toFile(resolve(uploadsDir, 'seed-bank-1.png'));

  const uploadId = await savePipelineResult(prisma, {
    sourceType: 'photo',
    nPages: 1,
    imageRef: '/uploads/seed-receipt.png',
    pageImageRefs: ['/uploads/seed-receipt.png'],
    result,
  });
  const cacUploadId = await savePipelineResult(prisma, { sourceType: 'pdf', nPages: 1, result: cacResult });
  const bankUploadId = await savePipelineResult(prisma, {
    sourceType: 'pdf',
    nPages: 2,
    imageRef: '/uploads/seed-bank-0.png',
    pageImageRefs: ['/uploads/seed-bank-0.png', '/uploads/seed-bank-1.png'],
    result: bankResult,
  });
  console.log(`seeded uploads ${uploadId} (receipt) + ${cacUploadId} (CAC mismatch) + ${bankUploadId} (2-page bank statement) — queue has 3 documents`);
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
