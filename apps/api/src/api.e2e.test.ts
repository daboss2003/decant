import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, mkdtempSync, existsSync } from 'node:fs';
import { createPrismaClient, savePipelineResult, type PrismaClient } from '@decant/db';
import type { PipelineResult } from '@decant/core';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, '..');
const tsx = resolve(apiDir, 'node_modules/.bin/tsx');
const dbFile = join(tmpdir(), `decant-api-${process.pid}.db`);
const url = `file:${dbFile}`;
const uploadsOut = mkdtempSync(join(tmpdir(), 'decant-api-uploads-'));
// 1x1 PNG (so persistPageImages has a real raster to copy)
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

let prisma: PrismaClient;
let server: ChildProcess;
let documentId: string;
let base: string;

const result = (): PipelineResult => ({
  uploadId: 'x',
  documents: [
    {
      documentId: 'd',
      docType: 'receipt',
      mode: 'typed',
      pageRange: [0, 0],
      reclassify: false,
      ruleResults: [],
      fields: [
        { fieldPath: 'total', value: 9999, confidence: 0.15, status: 'needs_review', signals: { gateFailed: true } },
        { fieldPath: 'merchantName', value: 'CAFE', confidence: 0.97, status: 'auto_approved', signals: {} },
      ],
    },
  ],
});

beforeAll(async () => {
  execSync('pnpm --filter @decant/db exec prisma db push --skip-generate --accept-data-loss', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  prisma = createPrismaClient(url);
  await savePipelineResult(prisma, { sourceType: 'photo', nPages: 1, result: result() });
  documentId = (await prisma.document.findFirstOrThrow()).id;

  // PORT=0 → ephemeral; read the bound port from the server's stdout (avoids
  // fixed-port collisions with any leftover/other server).
  // DECANT_PIPELINE_MODE=echo → uploads run offline (no Gemini): the ingested text
  // is persisted as a generic doc, so the upload flow is e2e-testable here.
  server = spawn(tsx, ['src/main.ts'], { cwd: apiDir, env: { ...process.env, DATABASE_URL: url, PORT: '0', DECANT_PIPELINE_MODE: 'echo', UPLOADS_DIR: uploadsOut }, stdio: ['ignore', 'pipe', 'pipe'] });
  const port = await new Promise<number>((res, rej) => {
    const t = setTimeout(() => rej(new Error('API did not start in time')), 40_000);
    let buf = '';
    const onData = (d: Buffer): void => {
      buf += d.toString();
      const m = buf.match(/API_LISTENING (\d+)/);
      if (m) {
        clearTimeout(t);
        res(Number(m[1]));
      }
    };
    server.stdout?.on('data', onData);
    server.stderr?.on('data', onData);
  });
  base = `http://127.0.0.1:${port}`;
}, 60_000);

afterAll(async () => {
  server?.kill('SIGKILL');
  await prisma?.$disconnect();
  rmSync(dbFile, { force: true });
  rmSync(uploadsOut, { recursive: true, force: true });
});

describe('Decant REST API (NestJS adapter over the same core/db)', () => {
  it('GET /health', async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
    expect((await r.json()).ok).toBe(true);
  });

  it('GET /review-queue lists flagged documents', async () => {
    const r = await fetch(`${base}/review-queue`);
    const queue = (await r.json()) as Array<{ documentId: string; flagged: string[] }>;
    expect(queue.some((d) => d.documentId === documentId && d.flagged.includes('total'))).toBe(true);
  });

  it('GET /documents/:id returns the document + fields; 404 for unknown', async () => {
    const r = await fetch(`${base}/documents/${documentId}`);
    expect(r.status).toBe(200);
    const doc = (await r.json()) as { docType: string; fields: unknown[] };
    expect(doc.docType).toBe('receipt');
    expect(doc.fields.length).toBe(2);
    expect((await fetch(`${base}/documents/does-not-exist`)).status).toBe(404);
  });

  it('POST /documents/:id/corrections writes the identical Correction + AuditEvent as web/MCP', async () => {
    const r = await fetch(`${base}/documents/${documentId}/corrections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fieldPath: 'total', action: 'accept', correctedValue: '8000', actor: 'api-test' }),
    });
    expect(r.status).toBe(201);

    const field = await prisma.field.findUnique({ where: { documentId_fieldPath: { documentId, fieldPath: 'total' } } });
    expect(field?.status).toBe('corrected');
    expect(field?.value).toBe(8000); // coerced to a number, not "8000"

    const audit = await fetch(`${base}/documents/${documentId}/audit`).then((x) => x.json());
    expect(JSON.stringify(audit)).toContain('corrected');
  });

  it('rejects a malformed correction body (Zod → 400)', async () => {
    const r = await fetch(`${base}/documents/${documentId}/corrections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'nope' }),
    });
    expect(r.status).toBe(400);
  });

  it('POST /uploads ingests a document, enqueues a job, and persists the result (echo mode)', async () => {
    const form = new FormData();
    form.append('files', new Blob(['# Receipt\nTOTAL 500 NGN'], { type: 'text/markdown' }), 'r.md');
    const r = await fetch(`${base}/uploads`, { method: 'POST', body: form });
    expect(r.status).toBe(201);
    const { jobId } = (await r.json()) as { jobId: string };
    expect(jobId).toBeTruthy();

    // in-process queue runs the handler inline, so the job is already done
    const state = (await fetch(`${base}/uploads/${jobId}`).then((x) => x.json())) as { status: string; documentId?: string };
    expect(state.status).toBe('done');
    expect(state.documentId).toBeTruthy();

    // the ingested born-digital TEXT reached the handler and was persisted
    const doc = (await fetch(`${base}/documents/${state.documentId}`).then((x) => x.json())) as { fields: Array<{ fieldPath: string; value: unknown }> };
    const raw = doc.fields.find((f) => f.fieldPath === 'rawText');
    expect(String(raw?.value)).toContain('TOTAL 500');
  });

  it('GET /uploads/:jobId is 404 for an unknown job', async () => {
    expect((await fetch(`${base}/uploads/nope`)).status).toBe(404);
  });

  it('an uploaded image is persisted as a served page so it shows in review', async () => {
    const form = new FormData();
    form.append('files', new Blob([PNG_1x1], { type: 'image/png' }), 'scan.png');
    const { jobId } = (await fetch(`${base}/uploads`, { method: 'POST', body: form }).then((r) => r.json())) as { jobId: string };
    const state = (await fetch(`${base}/uploads/${jobId}`).then((r) => r.json())) as { status: string; uploadId?: string };
    expect(state.status).toBe('done');

    const upload = await prisma.upload.findUniqueOrThrow({ where: { id: state.uploadId! } });
    expect(upload.imageRef).toBe(`/uploads/${jobId}-0.png`);
    expect(upload.pageImageRefs).toEqual([`/uploads/${jobId}-0.png`]);
    expect(existsSync(join(uploadsOut, `${jobId}-0.png`))).toBe(true); // actually copied to the served dir
  });
});
