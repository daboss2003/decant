import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createPrismaClient, savePipelineResult, type PrismaClient } from '@decant/db';
import type { PipelineResult } from '@decant/core';
import { createDecantMcp } from '../src/build-server';
import { createHttpMcpServer } from '../src/http-transport';

const TOKEN = 'test-secret-token';
const dbFile = join(tmpdir(), `decant-mcp-http-${process.pid}.db`);
const url = `file:${dbFile}`;

let prisma: PrismaClient;
let server: Server;
let endpoint: string;
let documentId: string;

beforeAll(async () => {
  execSync('pnpm --filter @decant/db exec prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  prisma = createPrismaClient(url);
  const result: PipelineResult = {
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
  };
  await savePipelineResult(prisma, { sourceType: 'photo', nPages: 1, result });
  documentId = (await prisma.document.findFirstOrThrow()).id;

  // In-process HTTP server on an ephemeral port; Host/Origin allow-lists are
  // computed per request from the bound address, so port 0 works.
  server = createHttpMcpServer({ buildServer: () => createDecantMcp(prisma), token: TOKEN, host: '127.0.0.1' });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  endpoint = `http://127.0.0.1:${port}/mcp`;
}, 60_000);

afterAll(async () => {
  server?.closeAllConnections?.();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  await prisma?.$disconnect();
  rmSync(dbFile, { force: true });
});

describe('Decant MCP server over HTTP (bearer-guarded)', () => {
  it('rejects a request with no Authorization header (401 + WWW-Authenticate: invalid_request)', async () => {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(401);
    const challenge = res.headers.get('www-authenticate') ?? '';
    expect(challenge).toContain('Bearer');
    expect(challenge).toContain('invalid_request');
  });

  it('rejects a wrong bearer token (401 + WWW-Authenticate: invalid_token)', async () => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: 'Bearer not-the-token', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate') ?? '').toContain('invalid_token');
  });

  it('rejects an oversized request body (413) even with a valid token', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024); // 2 MiB > the 1 MiB cap
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: big,
    });
    expect(res.status).toBe(413);
  });

  it('with the correct token: connects, elicits a correction, writes the audit trail (the §8 marquee, over HTTP)', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    const client = new Client({ name: 'decant-http-test', version: '0.0.0' }, { capabilities: { elicitation: {} } });

    // Auto-answer the server's elicitation (delivered over the GET SSE stream).
    client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'accept', content: { correctedValue: '8000' } }));

    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('review_document');

    const queue = await client.callTool({ name: 'list_review_queue', arguments: {} });
    expect(JSON.stringify(queue.content)).toContain(documentId);

    const reviewed = await client.callTool({ name: 'review_document', arguments: { documentId } });
    expect(JSON.stringify(reviewed.content)).toContain('total');

    await client.close();

    // The correction from HTTP elicitation must be identical to the stdio/web path.
    const field = await prisma.field.findUnique({
      where: { documentId_fieldPath: { documentId, fieldPath: 'total' } },
    });
    expect(field?.status).toBe('corrected');
    expect(field?.value).toBe(8000); // coerced to a number, not the string "8000"

    const audits = await prisma.auditEvent.findMany({ where: { documentId, type: 'corrected' } });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
