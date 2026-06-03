import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

/**
 * A tiny demo FX MCP server so the client-role enrichment is runnable end-to-end
 * without a third-party service. Deterministic fixed rates (quoted in USD per
 * unit) — a real adapter would call a live FX API. stdout carries the protocol,
 * so logs go to stderr only.
 */
const USD_PER: Record<string, number> = {
  USD: 1,
  NGN: 0.00065,
  EUR: 1.08,
  GBP: 1.27,
  KES: 0.0078,
  GHS: 0.067,
  ZAR: 0.055,
};

const json = (o: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(o) }] });
const errorJson = (msg: string) => ({ content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true });

const mcp = new McpServer({ name: 'decant-fx-demo', version: '0.1.0' });

mcp.registerTool(
  'convert_currency',
  {
    title: 'Convert currency',
    description: 'Convert an amount from one ISO currency to another at a (demo, fixed) rate.',
    inputSchema: { amount: z.number(), from: z.string(), to: z.string(), date: z.string().optional() },
  },
  async ({ amount, from, to, date }) => {
    const f = USD_PER[from.toUpperCase()];
    const t = USD_PER[to.toUpperCase()];
    if (f === undefined || t === undefined) return errorJson(`unsupported currency: ${from} or ${to}`);
    const rate = Math.round((f / t) * 1e6) / 1e6; // stabilise quoted rate (avoid float noise)
    const converted = Math.round(amount * rate * 100) / 100; // demo: all supported codes are 2-decimal currencies
    return json({ amount, from: from.toUpperCase(), to: to.toUpperCase(), date: date ?? 'latest', rate, converted });
  },
);

async function main(): Promise<void> {
  await mcp.connect(new StdioServerTransport());
  console.error('decant-fx-demo MCP server ready (stdio).');
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
