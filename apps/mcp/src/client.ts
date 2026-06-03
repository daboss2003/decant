import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * A small MCP client that spawns the Decant server over stdio and drives it.
 * Demonstrates the client side (tools, resources, and answering elicitation).
 *
 * Usage:
 *   pnpm --filter @decant/mcp run client                 # list tools + review queue
 *   pnpm --filter @decant/mcp run client <documentId>    # also read its resource + review it
 */
const here = dirname(fileURLToPath(import.meta.url));

function firstText(content: unknown): string {
  const arr = content as Array<{ text?: string }> | undefined;
  return arr?.[0]?.text ?? '';
}

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: resolve(here, '../node_modules/.bin/tsx'),
    args: [resolve(here, 'server.ts')],
    cwd: resolve(here, '..'),
    env: { ...process.env } as Record<string, string>,
  });
  const client = new Client({ name: 'decant-demo-client', version: '0.1.0' }, { capabilities: { elicitation: {} } });

  // Answer the server's elicitation. A real host shows the user a form; here we
  // auto-accept the current value so the demo runs unattended.
  client.setRequestHandler(ElicitRequestSchema, async (req) => {
    console.error(`  [elicit] ${req.params.message}`);
    return { action: 'decline' }; // demo: don't mutate; flip to accept+content to correct
  });

  await client.connect(transport);

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
