# @decant/enrich
> MCP *client* role: enrich + verify extracted documents against external sources.

**What it's for** — Decant's MCP *client* side (plan §8): it consumes OTHER MCP servers (company registry, FX) the way an MCP host consumes Decant. It enriches documents (e.g. converts money to a base currency) and verifies fields against an authority, folding each verdict into the trust loop and audit trail. Anyone can add a verification source by writing ONE `lookup` function — Decant owns the comparison/routing/audit machinery and picks no specific provider. External failure is recorded (routed to review), never silently dropped, and never sinks the document's extraction.

## Public API
- `ExternalMcpClient` — thin stdio MCP client (idempotent connect, timeouts, negative cache); calls a tool, parses its first text block (or `structuredContent`) as JSON.
- `McpServerSpec` / `ExternalMcpClientOptions` — server launch spec + client timeouts.
- `makeVerifier({ name, field, lookup, applies?, threshold?, compare?, source? })` — wrap one `VerificationLookup` into an `Enricher` that compares a field to an authority and folds the verdict in.
- `registryVerifier(lookup, opts?)` — provider/jurisdiction-agnostic "look up by id, check a field" verifier (defaults `rcNumber` → `companyName`).
- `mcpRegistryLookup(client)` — one example provider: a `VerificationLookup` over an MCP `lookup_company` tool (demo + GLEIF speak this).
- `mcpLookup(client, cfg)` — bridge a verification lookup to any MCP tool (zod-validated; malformed ⇒ unavailable).
- `FxEnricher` — converts money fields into a base currency via an FX MCP `convert_currency` tool (recomputes the figure locally).
- `EnrichmentService` — runs enrichers over a doc, best-effort (a throwing enricher is logged + skipped), and applies the results.
- `Enricher`, `fieldValue`, `asString`, `asNumber` — enricher interface + field helpers.
- Server paths: `FX_DEMO_SERVER`, `REGISTRY_DEMO_SERVER` (deterministic demos) and `FX_LIVE_SERVER` (open.er-api.com), `REGISTRY_GLEIF_SERVER` (GLEIF) — absolute paths to bundled stdio servers, run with `tsx`.

## How it's used
Wired in [apps/cli](../../apps/cli/src/wiring.ts) `buildEnrichment()`:
```ts
import {
  ExternalMcpClient, EnrichmentService, FxEnricher,
  registryVerifier, mcpRegistryLookup, FX_DEMO_SERVER, REGISTRY_DEMO_SERVER,
} from '@decant/enrich';

const tsx = '/abs/path/to/node_modules/.bin/tsx';
const fx = new ExternalMcpClient({ command: tsx, args: [FX_DEMO_SERVER] });       // swap → FX_LIVE_SERVER
const reg = new ExternalMcpClient({ command: tsx, args: [REGISTRY_DEMO_SERVER] }); // swap → REGISTRY_GLEIF_SERVER

const service = new EnrichmentService([
  new FxEnricher(fx, 'USD'),
  registryVerifier(mcpRegistryLookup(reg)),  // or pass your OWN VerificationLookup
]);
const enriched = await service.enrich(doc);   // doc: DocumentResult
await Promise.all([fx.close(), reg.close()]);
```
Add a custom source — write only the `lookup`:
```ts
const cac = makeVerifier({
  name: 'cac', field: 'companyName',
  applies: (doc) => !!fieldValue(doc, 'rcNumber'),
  lookup: async (doc) => {                 // return AuthorityRecord | null; THROW ⇒ unavailable
    const rec = await myCacApi(String(fieldValue(doc, 'rcNumber')));
    return rec ? { value: rec.name, standing: rec.status, reference: rec.rc, source: 'cac' } : null;
  },
});
```

**Env vars** — none required by the client or bundled servers. The live servers are keyless: `FX_LIVE_SERVER` → `open.er-api.com`, `REGISTRY_GLEIF_SERVER` → `api.gleif.org`. Do not forward `process.env` to a spawned server (it would leak `GEMINI_API_KEY` etc.); pass only the minimal `env` a specific server needs.

## Depends on
- [@decant/core](../core) — `DocumentResult`, `Enrichment`, `AuthorityRecord`, and the trust-loop machinery (`buildVerification`, `unavailableVerification`, `applyEnrichment`).
- `@modelcontextprotocol/sdk` — the MCP client/server runtime (stdio transport).
- `zod` — validates untrusted tool results at the boundary.

## Notes
- **Trust boundary:** `command`/`args` spawn a child process — keep them operator-controlled, never document- or untrusted-config-derived.
- **Untrusted output:** every external result is zod-validated; FX rates are sanity-checked and the converted amount is recomputed locally (the server's figure is not trusted).
- **Egress:** FX sends only the currency pair (amount stays local); the registry sends the RC number/company name.
- **`lookup` contract:** `AuthorityRecord` (`value` null ⇒ not found), `null` ⇒ not found, or **throw** ⇒ unavailable (still routed to review).
- This is the MCP *client* counterpart to the *server* role in [apps/mcp](../../apps/mcp).

Tests: `packages/enrich/test/` — run `pnpm test` from the repo root.
