import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { fetchWithTimeout } from './http';

/**
 * A REAL FX MCP server backed by open.er-api.com (free, no API key, 160+
 * currencies incl. NGN). Exposes the `convert_currency` contract Decant's
 * FxEnricher consumes — only the data source is real. The endpoint is latest-rate
 * only, so we do NOT accept a quote date (a historical-rate request would be a
 * false promise); the returned `date` is the rate's real as-of timestamp. The raw
 * API body is zod-validated. stdout carries the protocol → stderr logs.
 */
const json = (o: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(o) }] });
const errorJson = (msg: string) => ({ content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true });

const FxApiResponse = z.object({
  result: z.string().optional(),
  rates: z.record(z.string(), z.number()).optional(),
  time_last_update_utc: z.string().optional(),
  'error-type': z.string().optional(),
});

const mcp = new McpServer({ name: 'decant-fx-live', version: '0.1.0' });

mcp.registerTool(
  'convert_currency',
  {
    title: 'Convert currency (live)',
    description: 'Convert an amount between ISO currencies using live reference rates (open.er-api.com).',
    inputSchema: { amount: z.number(), from: z.string(), to: z.string() },
  },
  async ({ amount, from, to }) => {
    const F = from.toUpperCase();
    const T = to.toUpperCase();
    try {
      const res = await fetchWithTimeout(`https://open.er-api.com/v6/latest/${encodeURIComponent(F)}`);
      if (!res.ok) return errorJson(`FX API HTTP ${res.status}`);
      const parsed = FxApiResponse.safeParse(await res.json());
      if (!parsed.success) return errorJson('FX API returned an unexpected shape');
      const data = parsed.data;
      if (data.result !== 'success') return errorJson(`FX API error: ${data['error-type'] ?? 'unknown'} (base ${F})`);
      const rate = data.rates?.[T];
      if (typeof rate !== 'number') return errorJson(`unsupported currency: ${T}`);
      const converted = Math.round(amount * rate * 100) / 100;
      return json({
        amount,
        from: F,
        to: T,
        date: data.time_last_update_utc ?? 'latest',
        rate: Math.round(rate * 1e6) / 1e6,
        converted,
        source: 'open.er-api.com',
      });
    } catch (e) {
      return errorJson(`FX fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
);

async function main(): Promise<void> {
  await mcp.connect(new StdioServerTransport());
  console.error('decant-fx-live MCP server ready (stdio, open.er-api.com).');
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
