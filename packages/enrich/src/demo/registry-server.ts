import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

/**
 * A tiny demo company-registry MCP server (stands in for e.g. a CAC lookup) so
 * the verification path is runnable end-to-end. Deterministic canned records.
 * stdout carries the protocol — log to stderr only.
 */
const REGISTRY: Record<string, { name: string; status: string }> = {
  RC123456: { name: 'Acme Nigeria Limited', status: 'ACTIVE' },
  RC654321: { name: 'Globex Foods Plc', status: 'ACTIVE' },
  RC222333: { name: 'Initech Systems Ltd', status: 'INACTIVE' },
};

const json = (o: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(o) }] });

const mcp = new McpServer({ name: 'decant-registry-demo', version: '0.1.0' });

mcp.registerTool(
  'lookup_company',
  {
    title: 'Look up a company',
    description: 'Look up a company by its registration (RC) number; returns the authoritative registered name + status.',
    inputSchema: { rcNumber: z.string(), name: z.string().optional() }, // name accepted for contract parity (unused here)
  },
  async ({ rcNumber }) => {
    const rec = REGISTRY[rcNumber.toUpperCase().replace(/\s+/g, '')];
    if (!rec) return json({ rcNumber, found: false, name: null, status: null, source: 'demo' });
    return json({ rcNumber, found: true, name: rec.name, status: rec.status, source: 'demo' });
  },
);

async function main(): Promise<void> {
  await mcp.connect(new StdioServerTransport());
  console.error('decant-registry-demo MCP server ready (stdio).');
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
