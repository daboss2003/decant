import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * A small MCP client that drives the Decant server.
 *
 * Transport:
 *   - default: spawns the server over stdio.
 *   - MCP_SERVER_URL set: connects over Streamable HTTP with a bearer token
 *     (MCP_AUTH_TOKEN). requestInit.headers is folded into every request the SDK
 *     makes — POST, DELETE, AND the standalone GET SSE stream — so elicitation
 *     (which rides that GET stream) stays authenticated.
 *
 * Usage:
 *   pnpm --filter @decant/mcp run client                 # stdio: list tools + queue
 *   pnpm --filter @decant/mcp run client <documentId>    # also read its resource + review it
 *   MCP_SERVER_URL=http://127.0.0.1:3333 MCP_AUTH_TOKEN=… pnpm --filter @decant/mcp run client
 */
const here = dirname(fileURLToPath(import.meta.url));

function firstText(content: unknown): string {
  const arr = content as Array<{ text?: string }> | undefined;
  return arr?.[0]?.text ?? '';
}

function makeTransport(): Transport {
  const url = process.env.MCP_SERVER_URL;
  if (url) {
    const token = process.env.MCP_AUTH_TOKEN;
    if (!token) throw new Error('MCP_SERVER_URL is set but MCP_AUTH_TOKEN is missing (the server requires a bearer token).');
    return new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
  }
  return new StdioClientTransport({
    command: resolve(here, '../node_modules/.bin/tsx'),
    args: [resolve(here, 'server.ts')],
    cwd: resolve(here, '..'),
    env: { ...process.env } as Record<string, string>,
  });
}

async function main(): Promise<void> {
  const client = new Client({ name: 'decant-demo-client', version: '0.1.0' }, { capabilities: { elicitation: {} } });

  // Answer the server's elicitation. A real host shows the user a form; here we
  // auto-decline so the demo runs unattended (flip to accept+content to correct).
  client.setRequestHandler(ElicitRequestSchema, async (req) => {
    console.error(`  [elicit] ${req.params.message}`);
    return { action: 'decline' };
  });

  await client.connect(makeTransport());

  const tools = await client.listTools();
  console.log('Tools:', tools.tools.map((t) => t.name).join(', '));

  const queue = await client.callTool({ name: 'list_review_queue', arguments: {} });
  console.log('\nReview queue:\n' + firstText(queue.content));

  const docId = process.argv[2];
  if (docId) {
    const doc = await client.readResource({ uri: `decant://documents/${docId}` });
    console.log('\nDocument resource (decant://documents/' + docId + '):\n' + firstText(doc.contents));
    const reviewed = await client.callTool({ name: 'review_document', arguments: { documentId: docId } });
    console.log('\nreview_document result:\n' + firstText(reviewed.content));
  }

  await client.close();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
