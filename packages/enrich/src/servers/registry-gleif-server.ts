import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { fetchWithTimeout } from './http';

/**
 * A REAL company-registry MCP server backed by GLEIF (api.gleif.org — the free,
 * no-key global Legal Entity Identifier registry). Looks an entity up by legal
 * NAME and returns the authoritative registered name + status + jurisdiction, so
 * Decant can corroborate an extracted company name against an external authority.
 *
 * NOTE on scope: Nigeria's CAC has no free public API, so a true RC-number → name
 * lookup needs the official (credentialed) CAC service. GLEIF stands in as a real,
 * verifiable global registry; the `lookup_company` contract matches the demo
 * server (it also accepts `rcNumber`, unused here). stdout = protocol → stderr logs.
 */
const json = (o: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(o) }] });
const errorJson = (msg: string) => ({ content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true });

const GleifResponse = z.object({
  data: z
    .array(
      z.object({
        attributes: z.object({
          lei: z.string(),
          entity: z.object({
            legalName: z.object({ name: z.string() }),
            status: z.string().nullable().optional(),
            legalAddress: z.object({ country: z.string().nullable().optional() }).optional(),
          }),
        }),
      }),
    )
    .optional(),
});

/** Suffix-insensitive normalization used to prefer an exact candidate over GLEIF's relevance rank. */
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const mcp = new McpServer({ name: 'decant-registry-gleif', version: '0.1.0' });

mcp.registerTool(
  'lookup_company',
  {
    title: 'Look up a company (live registry)',
    description: 'Look up a legal entity by name in the GLEIF global registry; returns the authoritative name + status.',
    inputSchema: { rcNumber: z.string().optional(), name: z.string().optional() },
  },
  async ({ name }) => {
    const q = (name ?? '').trim();
    // GLEIF is name-based: with no name we did not actually query anything →
    // signal `queried:false` so the client records "unavailable", not "not found".
    if (!q) return json({ found: false, name: null, queried: false, source: 'gleif' });
    try {
      // Fetch several candidates and prefer an exact (suffix-insensitive) name match
      // over GLEIF's global relevance rank, to avoid auto-picking a foreign near-name.
      const url = `https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]=${encodeURIComponent(q)}&page[size]=10`;
      const res = await fetchWithTimeout(url, { headers: { accept: 'application/vnd.api+json' } });
      if (!res.ok) return errorJson(`registry HTTP ${res.status}`);
      const parsed = GleifResponse.safeParse(await res.json());
      if (!parsed.success) return errorJson('registry returned an unexpected GLEIF shape');
      const recs = parsed.data.data ?? [];
      if (recs.length === 0) return json({ found: false, name: null, source: 'gleif' });
      const target = norm(q);
      const rec = recs.find((r) => norm(r.attributes.entity.legalName.name) === target) ?? recs[0]!;
      const ent = rec.attributes.entity;
      return json({
        found: true,
        name: ent.legalName.name,
        status: ent.status ?? null,
        country: ent.legalAddress?.country ?? null,
        lei: rec.attributes.lei,
        source: 'gleif',
      });
    } catch (e) {
      return errorJson(`registry fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
);

async function main(): Promise<void> {
  await mcp.connect(new StdioServerTransport());
  console.error('decant-registry-gleif MCP server ready (stdio, api.gleif.org).');
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
