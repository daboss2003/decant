import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createPrismaClient, savePipelineResult, type PrismaClient } from '@decant/db';
import type { PipelineResult } from '@decant/core';

const here = dirname(fileURLToPath(import.meta.url));
const mcpDir = resolve(here, '..');
const dbFile = join(tmpdir(), `decant-mcp-${process.pid}.db`);
const url = `file:${dbFile}`;

let prisma: PrismaClient;
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
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dbFile, { force: true });
});

describe('Decant MCP server', () => {
  it('lists the queue, elicits a correction, and writes the audit trail (the §8 marquee)', async () => {
    const transport = new StdioClientTransport({
      command: resolve(mcpDir, 'node_modules/.bin/tsx'),
      args: [resolve(mcpDir, 'src/server.ts')],
      cwd: mcpDir,
      env: { ...process.env, DATABASE_URL: url },
    });
    const client = new Client({ name: 'decant-test-client', version: '0.0.0' }, { capabilities: { elicitation: {} } });

    // Auto-answer the server's elicitation: accept with a corrected number.
    client.setRequestHandler(ElicitRequestSchema, async () => ({
      action: 'accept',
      content: { correctedValue: '8000' },
    }));

    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('review_document');

    const queue = await client.callTool({ name: 'list_review_queue', arguments: {} });
    expect(JSON.stringify(queue.content)).toContain(documentId);

    const reviewed = await client.callTool({ name: 'review_document', arguments: { documentId } });
    expect(JSON.stringify(reviewed.content)).toContain('total');

    await client.close();

    // The correction the MCP elicitation produced must be identical to the web path:
    const field = await prisma.field.findUnique({
      where: { documentId_fieldPath: { documentId, fieldPath: 'total' } },
    });
    expect(field?.status).toBe('corrected');
    expect(field?.value).toBe(8000); // coerced to a number, not the string "8000"

    const audits = await prisma.auditEvent.findMany({ where: { documentId, type: 'corrected' } });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
