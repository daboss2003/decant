import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { createPrismaClient, savePipelineResult, type PrismaClient } from '@decant/db';
import type { PipelineResult } from '@decant/core';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, '..');
const tsx = resolve(apiDir, 'node_modules/.bin/tsx');
const dbFile = join(tmpdir(), `decant-api-${process.pid}.db`);
const url = `file:${dbFile}`;

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
  server = spawn(tsx, ['src/main.ts'], { cwd: apiDir, env: { ...process.env, DATABASE_URL: url, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
});
