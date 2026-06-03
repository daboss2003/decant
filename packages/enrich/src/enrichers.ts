import { z } from 'zod';
import {
  buildRegistryEnrichment,
  normalizeDate,
  type DocumentResult,
  type Enrichment,
  type FxEnrichment,
  type RegistryEnrichment,
} from '@decant/core';
import type { ExternalMcpClient } from './mcp-client';

/** An enricher consumes one external MCP server and returns 0..n enrichments for a document. */
export interface Enricher {
  enrich(doc: DocumentResult): Promise<Enrichment[]>;
}

function fieldValue(doc: DocumentResult, path: string): unknown {
  return doc.fields.find((f) => f.fieldPath === path)?.value;
}
function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
}
function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

// External servers are untrusted: validate their output at the boundary before it
// becomes a persisted/displayed financial value.
const FxToolResult = z.object({ rate: z.number().finite().nonnegative(), converted: z.number().finite(), date: z.string().min(1) });
const RegistryToolResult = z.object({ found: z.boolean(), name: z.string().nullable().optional(), status: z.string().nullable().optional() });

/**
 * Converts money fields into a base currency via an external FX MCP server
 * (enrichment — adds a derived value, no verification verdict). The rate date is
 * normalised to ISO (or omitted so the server quotes its latest) rather than
 * forwarding the raw free-text extraction, and the server's response is validated.
 */
export class FxEnricher implements Enricher {
  constructor(
    private readonly client: ExternalMcpClient,
    private readonly base = 'USD',
    private readonly moneyFields: string[] = ['total'],
  ) {}

  async enrich(doc: DocumentResult): Promise<Enrichment[]> {
    const currency = asString(fieldValue(doc, 'currency'));
    if (!currency || currency.toUpperCase() === this.base.toUpperCase()) return [];
    const rawDate = asString(fieldValue(doc, 'transactionDate'));
    const isoDate = rawDate ? normalizeDate(rawDate) : null;

    const out: FxEnrichment[] = [];
    for (const field of this.moneyFields) {
      const amount = asNumber(fieldValue(doc, field));
      if (amount == null) continue;
      // EGRESS: amount + currency (+ normalized date) leave the process to the FX server.
      const raw = await this.client.callTool<unknown>('convert_currency', {
        amount,
        from: currency,
        to: this.base,
        ...(isoDate ? { date: isoDate } : {}), // omit → server uses its latest rate
      });
      const parsed = FxToolResult.safeParse(raw);
      if (!parsed.success) continue; // ignore a malformed/untrusted FX response
      out.push({
        kind: 'fx',
        field,
        amount,
        currency,
        base: this.base,
        baseAmount: parsed.data.converted,
        rate: parsed.data.rate,
        asOf: parsed.data.date,
      });
    }
    return out;
  }
}

/**
 * Verifies a company against an external registry MCP server: looks up the RC
 * number and compares the registered name to the extracted one. A mismatch /
 * not-found / unreachable registry all yield a verdict that routes companyName to
 * review (see applyEnrichment) — an external-source safe failure. Crucially, an
 * unreachable registry is recorded as `unavailable` (NOT silently skipped) so
 * "couldn't verify" is never mistaken for "verified".
 */
export class RegistryEnricher implements Enricher {
  constructor(private readonly client: ExternalMcpClient) {}

  async enrich(doc: DocumentResult): Promise<Enrichment[]> {
    const rcNumber = asString(fieldValue(doc, 'rcNumber'));
    if (!rcNumber) return [];
    const extractedName = asString(fieldValue(doc, 'companyName'));

    const unavailable = (): RegistryEnrichment[] => [
      { kind: 'registry', rcNumber, registeredName: null, extractedName, nameMatchScore: 0, status: 'unavailable' },
    ];

    try {
      // EGRESS: only the RC number leaves the process; the name comparison stays local.
      const parsed = RegistryToolResult.safeParse(await this.client.callTool<unknown>('lookup_company', { rcNumber }));
      if (!parsed.success) return unavailable();
      return [
        buildRegistryEnrichment({
          rcNumber,
          registeredName: parsed.data.found ? (parsed.data.name ?? null) : null,
          extractedName,
        }),
      ];
    } catch {
      return unavailable(); // registry unreachable/timed out — record it, don't drop it
    }
  }
}
