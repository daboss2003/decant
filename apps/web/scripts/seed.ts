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
      fields: [
        { fieldPath: 'merchantName', value: 'CAFE NEABLE', confidence: 0.97, status: 'auto_approved', signals: {} },
        { fieldPath: 'transactionDate', value: '2026-05-01', confidence: 0.95, status: 'auto_approved', signals: {} },
        { fieldPath: 'currency', value: 'NGN', confidence: 0.93, status: 'auto_approved', signals: {} },
        { fieldPath: 'subtotal', value: 1000, confidence: 0.15, status: 'needs_review', signals: { gateFailed: true } },
        { fieldPath: 'tax', value: 75, confidence: 0.15, status: 'needs_review', signals: { gateFailed: true } },
        { fieldPath: 'total', value: 9999, confidence: 0.15, status: 'needs_review', signals: { gateFailed: true } },
      ],
    },
  ],
};

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

  const uploadId = await savePipelineResult(prisma, {
    sourceType: 'photo',
    nPages: 1,
    imageRef: '/uploads/seed-receipt.png',
    result,
  });
  console.log(`seeded upload ${uploadId} (review queue has 1 document)`);
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
