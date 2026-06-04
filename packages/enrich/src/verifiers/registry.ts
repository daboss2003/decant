import { z } from 'zod';
import type { DocumentResult } from '@decant/core';
import type { Enricher } from '../enrichers';
import { fieldValue } from '../enrichers';
import { makeVerifier, mcpLookup, type VerificationLookup } from '../verifier';
import type { ExternalMcpClient } from '../mcp-client';

const present = (doc: DocumentResult, field: string): boolean => {
  const v = fieldValue(doc, field);
  return typeof v === 'string' && v.trim() !== '';
};

export interface RegistryVerifierOptions {
  /** Verifier id (drives the signal/audit key), e.g. 'cac', 'companiesHouse', 'sec'. Default 'registry'. */
  name?: string;
  /** The identifier field whose presence triggers the lookup. Default 'rcNumber' (NG CAC). */
  idField?: string;
  /** The field whose value is compared to the authority. Default 'companyName'. */
  valueField?: string;
  threshold?: number;
  compare?: (a: string, b: string) => number;
}

/**
 * Convenience for the common "look an entity up by an identifier and check a
 * field against the authority" shape — PROVIDER- AND JURISDICTION-AGNOSTIC.
 * Decant picks no registry: the consumer supplies the `lookup` (their official CAC
 * API, UK Companies House, SEC EDGAR, GLEIF, an internal DB, …). The defaults
 * (`rcNumber` → `companyName`) match the bundled CAC example; override
 * `idField`/`valueField`/`name` for any other registry. For non-registry checks
 * (tax ID, bank account, sanctions, address) use `makeVerifier` directly.
 *
 *   registryVerifier(myCacLookup);                                   // NG CAC (defaults)
 *   registryVerifier(myUkLookup, { name: 'companiesHouse', idField: 'companyNumber' });
 */
export function registryVerifier(lookup: VerificationLookup, opts: RegistryVerifierOptions = {}): Enricher {
  const idField = opts.idField ?? 'rcNumber';
  return makeVerifier({
    name: opts.name ?? 'registry',
    field: opts.valueField ?? 'companyName',
    source: opts.name ?? 'registry',
    applies: (doc) => present(doc, idField),
    lookup,
    threshold: opts.threshold,
    compare: opts.compare,
  });
}

const RegistryResult = z.object({
  found: z.boolean(),
  name: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  lei: z.string().nullable().optional(),
  source: z.string().optional(),
  /** false ⇒ the registry could not query this input (e.g. name-based registry, no name). */
  queried: z.boolean().optional(),
});

/**
 * ONE example provider: a lookup backed by an MCP `lookup_company` tool (the
 * bundled demo + GLEIF servers speak this contract). A consumer can use it, or
 * pass their own `VerificationLookup` to `registryVerifier` instead.
 */
export function mcpRegistryLookup(client: ExternalMcpClient): VerificationLookup {
  return mcpLookup(client, {
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
  });
}
