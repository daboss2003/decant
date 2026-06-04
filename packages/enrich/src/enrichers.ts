import { z } from 'zod';
import { type DocumentResult, type Enrichment, type FxEnrichment } from '@decant/core';
import type { ExternalMcpClient } from './mcp-client';

/** An enricher consumes one external source and returns 0..n enrichments for a document. */
export interface Enricher {
  enrich(doc: DocumentResult): Promise<Enrichment[]>;
}

/** Read a flattened field's value by path (e.g. 'companyName', 'total'). */
export function fieldValue(doc: DocumentResult, path: string): unknown {
  return doc.fields.find((f) => f.fieldPath === path)?.value;
}
export function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
}
export function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

// External servers are untrusted: validate their output at the boundary before it
// becomes a persisted/displayed financial value. The rate must be a sane positive
// number (reject 0 / absurd magnitudes); the converted figure is recomputed
// locally from it rather than trusted.
const FxToolResult = z.object({ rate: z.number().finite().positive().lte(1e9), date: z.string().min(1) });

/**
 * Converts money fields into a base currency via an external FX MCP server
 * (enrichment — adds a derived value, no verification verdict). The base amount is
 * recomputed locally from the validated rate (the server's `converted` is not
 * trusted), and `asOf` carries the rate's real quote date. We do not send a quote
 * date: the free endpoint is latest-only, so requesting a historical rate would be
 * a false expectation.
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

    const out: FxEnrichment[] = [];
    for (const field of this.moneyFields) {
      const amount = asNumber(fieldValue(doc, field));
      if (amount == null) continue;
      // EGRESS: only the currency pair leaves the process — the amount stays local.
      const raw = await this.client.callTool<unknown>('convert_currency', { amount, from: currency, to: this.base });
      const parsed = FxToolResult.safeParse(raw);
      if (!parsed.success) continue; // ignore a malformed/untrusted FX response
      out.push({
        kind: 'fx',
        field,
        amount,
        currency,
        base: this.base,
        baseAmount: Math.round(amount * parsed.data.rate * 100) / 100, // derive locally, don't trust the server's figure
        rate: parsed.data.rate,
        asOf: parsed.data.date,
      });
    }
    return out;
  }
}
