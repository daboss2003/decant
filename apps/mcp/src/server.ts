import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  DocumentPipeline,
  RuleValidationService,
  HeuristicConfidenceService,
  ThresholdRoutingService,
  registry,
  KNOWN_DOC_TYPES,
} from '@decant/core';
import {
  GoogleGenAIClient,
  GeminiClassifyService,
  GeminiExtractionService,
  type PageImageStore,
  type LoadedImage,
} from '@decant/gemini';
import { createPrismaClient, PrismaReviewService } from '@decant/db';

/**
 * Decant MCP server (plan §8). A thin adapter over the SAME domain core + db the
 * web UI uses — so a correction made here writes an identical Correction +
 * AuditEvent. Marquee feature: the review step is MCP elicitation.
 *
 * NOTE: stdio transport uses stdout for the protocol — never console.log here
 * (logs go to stderr only).
 */
const dbUrl = process.env.DATABASE_URL ?? `file:${resolve(process.cwd(), '../../packages/db/prisma/dev.db')}`;
const prisma = createPrismaClient(dbUrl);
const review = new PrismaReviewService(prisma);

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf' };
async function loadImage(path: string): Promise<LoadedImage> {
  const buf = await readFile(path);
  return { mimeType: MIME[extname(path).toLowerCase()] ?? 'application/octet-stream', dataBase64: buf.toString('base64') };
}

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });
const errorText = (s: string) => ({ content: [{ type: 'text' as const, text: s }], isError: true });

const mcp = new McpServer({ name: 'decant', version: '0.1.0' });

// ── Tools ────────────────────────────────────────────────────────────────────

mcp.registerTool(
  'list_review_queue',
  { title: 'List review queue', description: 'Documents with at least one field flagged for human review.', inputSchema: {} },
  async () => {
    const docs = await prisma.document.findMany({
      where: { fields: { some: { status: 'needs_review' } } },
      include: { fields: { where: { status: 'needs_review' }, select: { fieldPath: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const queue = docs.map((d) => ({ documentId: d.id, docType: d.docType, flagged: d.fields.map((f) => f.fieldPath) }));
    return text(JSON.stringify(queue, null, 2));
  },
);

mcp.registerTool(
  'get_document',
  { title: 'Get document', description: 'A document and its extracted fields.', inputSchema: { documentId: z.string() } },
  async ({ documentId }) => {
    const doc = await prisma.document.findUnique({ where: { id: documentId }, include: { fields: true } });
    return doc ? text(JSON.stringify(doc, null, 2)) : errorText(`No document ${documentId}`);
  },
);

mcp.registerTool(
  'correct_field',
  {
    title: 'Correct a field',
    description: 'Apply a correction to a single field (non-interactive). Writes a Correction + AuditEvent.',
    inputSchema: { documentId: z.string(), fieldPath: z.string(), value: z.string() },
  },
  async ({ documentId, fieldPath, value }) => {
    try {
      await review.applyCorrection({ documentId, fieldPath, action: 'accept', correctedValue: value, actor: 'mcp' });
      return text(`Corrected ${fieldPath}.`);
    } catch (e) {
      return errorText(e instanceof Error ? e.message : 'Could not apply correction.');
    }
  },
);

// Marquee: the human-in-the-loop review step IS MCP elicitation.
mcp.registerTool(
  'review_document',
  {
    title: 'Review a document',
    description: 'Walk the flagged fields and elicit a correction for each from the human, then record it.',
    inputSchema: { documentId: z.string() },
  },
  async ({ documentId }) => {
    const doc = await prisma.document.findUnique({ where: { id: documentId }, include: { fields: true } });
    if (!doc) return errorText(`No document ${documentId}`);
    const flagged = doc.fields.filter((f) => f.status === 'needs_review');
    if (flagged.length === 0) return text('Nothing to review — no flagged fields.');

    const summary: string[] = [];
    try {
      for (const f of flagged) {
        const res = await mcp.server.elicitInput({
          message: `Field "${f.fieldPath}" was flagged (confidence ${f.confidence.toFixed(2)}). Current value: ${JSON.stringify(f.value)}. Enter the correct value, or decline if it's unreadable.`,
          requestedSchema: {
            type: 'object',
            properties: {
              correctedValue: { type: 'string', description: `Correct value for ${f.fieldPath}` },
              note: { type: 'string', description: 'Optional note' },
            },
            required: ['correctedValue'],
          },
        });

        if (res.action === 'accept' && res.content) {
          await review.applyCorrection({
            documentId,
            fieldPath: f.fieldPath,
            action: 'accept',
            correctedValue: String(res.content.correctedValue ?? ''),
            note: res.content.note ? String(res.content.note) : undefined,
            actor: 'mcp',
          });
          summary.push(`✓ ${f.fieldPath} → ${String(res.content.correctedValue)}`);
        } else {
          await review.applyCorrection({
            documentId,
            fieldPath: f.fieldPath,
            action: res.action === 'decline' ? 'decline' : 'cancel',
            actor: 'mcp',
          });
          summary.push(`⚑ ${f.fieldPath} (${res.action})`);
        }
      }
    } catch (e) {
      return errorText(
        `Elicitation failed (the client may not support it — use correct_field instead): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return text(summary.join('\n'));
  },
);

mcp.registerTool(
  'extract_document',
  {
    title: 'Extract a document',
    description: 'Run the extraction pipeline (Gemini) on a local image/PDF path and return structured fields.',
    inputSchema: { path: z.string() },
  },
  async ({ path }) => {
    if (!process.env.GEMINI_API_KEY) return errorText('GEMINI_API_KEY is not set on the server.');
    const abs = resolve(path);
    const store: PageImageStore = {
      loadByRef: (ref) => loadImage(ref),
      loadByUpload: async () => [await loadImage(abs)],
    };
    const client = new GoogleGenAIClient(process.env.GEMINI_API_KEY);
    const pipeline = new DocumentPipeline(
      {
        classify: new GeminiClassifyService(client, store, { knownTypes: [...KNOWN_DOC_TYPES] }),
        extraction: new GeminiExtractionService(client, store, registry),
        validation: new RuleValidationService(registry),
        confidence: new HeuristicConfidenceService(),
        routing: new ThresholdRoutingService(),
      },
      { knownTypes: KNOWN_DOC_TYPES, minClassifyConfidence: 0.5 },
    );
    const result = await pipeline.process(`mcp:${abs}`, [{ pageIndex: 0, imageRef: abs }]);
    return text(JSON.stringify(result, null, 2));
  },
);

// ── Resources ────────────────────────────────────────────────────────────────

mcp.registerResource(
  'document',
  new ResourceTemplate('decant://documents/{id}', { list: undefined }),
  { title: 'Document', description: 'A document and its fields' },
  async (uri, { id }) => {
    const doc = await prisma.document.findUnique({ where: { id: String(id) }, include: { fields: true } });
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(doc ?? { error: 'not found' }, null, 2) }] };
  },
);

mcp.registerResource(
  'audit',
  new ResourceTemplate('decant://audit/{id}', { list: undefined }),
  { title: 'Audit trail', description: 'Append-only audit events for a document' },
  async (uri, { id }) => {
    const events = await prisma.auditEvent.findMany({ where: { documentId: String(id) }, orderBy: { timestamp: 'asc' } });
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(events, null, 2) }] };
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  console.error('Decant MCP server ready (stdio).');
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
