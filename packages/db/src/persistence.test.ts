import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createPrismaClient, type PrismaClient } from './client';
import { savePipelineResult } from './repository';
import { PrismaReviewService } from './review.service';
import type { PipelineResult } from '@decant/core';

const dbFile = join(tmpdir(), `decant-persist-${process.pid}.db`);
const url = `file:${dbFile}`;
let prisma: PrismaClient;

beforeAll(() => {
  // Materialise the schema into a fresh temp SQLite DB.
  execSync('pnpm --filter @decant/db exec prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  prisma = createPrismaClient(url);
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(dbFile, { force: true });
});

const makeResult = (): PipelineResult => ({
  uploadId: 'ignored',
  documents: [
    {
      documentId: 'doc-0',
      docType: 'receipt',
      mode: 'typed',
      pageRange: [0, 0],
      reclassify: false,
      ruleResults: [],
      fields: [
        { fieldPath: 'total', value: 1075, confidence: 0.97, status: 'auto_approved', signals: { gatePassed: true } },
        { fieldPath: 'merchantTaxId', value: null, confidence: 0, status: 'needs_review', signals: {} },
      ],
    },
  ],
});

describe('persistence', () => {
  it('saves a pipeline result and round-trips documents + fields', async () => {
    const uploadId = await savePipelineResult(prisma, { sourceType: 'photo', nPages: 1, result: makeResult() });
    const docs = await prisma.document.findMany({ where: { uploadId }, include: { fields: true } });
    expect(docs).toHaveLength(1);
    expect(docs[0]?.fields).toHaveLength(2);
    const total = docs[0]?.fields.find((f) => f.fieldPath === 'total');
    expect(total?.status).toBe('auto_approved');
    expect(total?.value).toBe(1075);
  });

  it('applyCorrection writes a Correction + AuditEvent and marks the field corrected (the audit trail)', async () => {
    const uploadId = await savePipelineResult(prisma, { sourceType: 'photo', nPages: 1, result: makeResult() });
    const doc = await prisma.document.findFirstOrThrow({ where: { uploadId } });

    const review = new PrismaReviewService(prisma);
    await review.applyCorrection({
      documentId: doc.id,
      fieldPath: 'merchantTaxId',
      action: 'accept',
      correctedValue: 'RC123456',
      note: 'read from the stamp',
      actor: 'tester',
    });

    const field = await prisma.field.findUnique({
      where: { documentId_fieldPath: { documentId: doc.id, fieldPath: 'merchantTaxId' } },
      include: { corrections: true },
    });
    expect(field?.status).toBe('corrected');
    expect(field?.value).toBe('RC123456');
    expect(field?.corrections).toHaveLength(1);

    const audits = await prisma.auditEvent.findMany({ where: { fieldId: field?.id, type: 'corrected' } });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('a correction to a numeric field STAYS a number (no type corruption)', async () => {
    const uploadId = await savePipelineResult(prisma, { sourceType: 'photo', nPages: 1, result: makeResult() });
    const doc = await prisma.document.findFirstOrThrow({ where: { uploadId } });

    const review = new PrismaReviewService(prisma);
    // human types "2,000" as a string; the stored value must remain a JS number
    await review.applyCorrection({
      documentId: doc.id,
      fieldPath: 'total',
      action: 'accept',
      correctedValue: '2,000',
      actor: 'tester',
    });

    const field = await prisma.field.findUnique({
      where: { documentId_fieldPath: { documentId: doc.id, fieldPath: 'total' } },
    });
    expect(field?.value).toBe(2000);
    expect(typeof field?.value).toBe('number');
  });
});
