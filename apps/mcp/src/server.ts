import { resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPrismaClient } from '@decant/db';
import { createDecantMcp } from './build-server';
import { createHttpMcpServer } from './http-transport';

/**
 * Decant MCP server entrypoint (plan §8). Two transports over the SAME domain
 * core + db:
 *   - stdio  (default): the host launches the process; auth comes from the env.
 *   - http   (MCP_TRANSPORT=http): Streamable HTTP, guarded by a bearer token
 *     (MCP_AUTH_TOKEN), bound to loopback.
 *
 * NOTE: on the stdio path stdout carries the protocol — never console.log there;
 * logs go to stderr only.
 */
const dbUrl = process.env.DATABASE_URL ?? `file:${resolve(process.cwd(), '../../packages/db/prisma/dev.db')}`;
const prisma = createPrismaClient(dbUrl);
const buildServer = () => createDecantMcp(prisma);

async function main(): Promise<void> {
  if ((process.env.MCP_TRANSPORT ?? 'stdio') === 'http') {
    const token = process.env.MCP_AUTH_TOKEN;
    if (!token) {
      console.error('Refusing to start the HTTP MCP server: MCP_AUTH_TOKEN is not set (fail closed).');
      process.exit(1);
    }
    const host = process.env.MCP_HOST ?? '127.0.0.1';
    const port = Number(process.env.MCP_PORT ?? 3333);
    const server = createHttpMcpServer({ buildServer, token, host });
    server.listen(port, host, () => console.error(`Decant MCP server ready (http://${host}:${port}, bearer-guarded).`));
    return;
  }

  const mcp = buildServer();
  await mcp.connect(new StdioServerTransport());
  console.error('Decant MCP server ready (stdio).');
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
