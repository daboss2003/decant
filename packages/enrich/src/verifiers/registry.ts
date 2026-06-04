import { z } from 'zod';
import type { Enricher } from '../enrichers';
import { fieldValue } from '../enrichers';
import { makeVerifier, mcpLookup } from '../verifier';
import type { ExternalMcpClient } from '../mcp-client';

/**
 * The company-registry verifier — Decant's first-party `Verifier`, demonstrating
 * the adapter over an MCP-backed source (the demo or GLEIF `lookup_company`
 * server). It verifies the extracted `companyName` for any doc carrying an
 * `rcNumber`. Anyone can add their own source the same way (see makeVerifier).
 */
const RegistryResult = z.object({
  found: z.boolean(),
  name: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  lei: z.string().nullable().optional(),
  source: z.string().optional(),
  /** false ⇒ the registry could not query this input (e.g. name-based registry, no name). */
  queried: z.boolean().optional(),
});

export function registryVerifier(client: ExternalMcpClient): Enricher {
  return makeVerifier({
    name: 'registry',
    field: 'companyName',
    source: 'registry',
    applies: (doc) => {
      const rc = fieldValue(doc, 'rcNumber');
      return typeof rc === 'string' && rc.trim() !== '';
    },
    lookup: mcpLookup(client, {
      tool: 'lookup_company',
      // EGRESS: the RC number (and, for name-based registries, the company name) leave the process.
      args: (doc) => {
        const args: Record<string, unknown> = {};
        const rc = fieldValue(doc, 'rcNumber');
        if (typeof rc === 'string') args.rcNumber = rc;
        const name = fieldValue(doc, 'companyName');
        if (typeof name === 'string' && name.trim()) args.name = name;
        return args;
      },
      schema: RegistryResult,
      map: (r) => {
        if (r.queried === false) throw new Error('registry could not query this input'); // → unavailable
        if (!r.found) return null; // not found
        return { value: r.name ?? null, standing: r.status ?? null, reference: r.lei ?? null, source: r.source ?? 'registry' };
      },
    }),
  });
}
