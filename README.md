# Decant

Turn messy, real-world financial documents into **validated, structured data that's trustworthy enough for a financial workflow — and that knows when it can't be trusted and asks a human.**

Anyone can prompt a vision model to read a receipt. The differentiator here is **calibrated confidence + safe failure**: every field gets a confidence score, low-confidence fields route to a human review queue, and every extraction/correction is recorded in an audit trail.

## How it works

```
upload → Classify (Gemini Flash-Lite, batched) → segment into documents
       → Extract (Gemini, typed per registered type | generic fallback)
       → Validate (schema + domain/reconciliation rules)
       → Confidence (fuse signals) → Route (auto-approve | needs review)
       → persist + Audit trail → human review (web UI / MCP elicitation)
```

A document classifies to a **registered type** (receipt/invoice, bank statement, …) → full typed schema + domain rules + per-type confidence; anything else falls back to a **generic, low-trust** extractor that always routes to review. The strongest confidence signal is **reconciliation** — receipt totals must add up; a bank statement's running balance must walk row by row — which localizes errors to the exact field/row.

## Packages

| Package | What it is |
|---|---|
| `packages/schemas` | Zod single source of truth (drives Gemini structured output, validation, types, MCP/elicitation) |
| `packages/core` | Transport-agnostic domain core: registry, segmentation, rules, confidence, routing, the pipeline orchestrator |
| `packages/gemini` | `@google/genai`-backed Classify + Extract services (the SDK behind a mockable interface) |
| `packages/ocr` | tesseract.js `OcrProvider` → per-field bbox provenance (fuzzy-aligned to each value, independent of the model's claim) |
| `packages/enrich` | the **MCP client role** + a **pluggable verification adapter** (`makeVerifier` — add a source by implementing one `lookup`); FX enrichment + company-registry verification, with bundled demo and real (open.er-api/GLEIF) servers |
| `packages/db` | Prisma + SQLite persistence + the audit-trail-writing `ReviewService` |
| `packages/eval` | Gold scoring + success metrics (field accuracy, reliability/ECE/Brier, safe-failure rate, threshold sweep) |
| `apps/cli` | Run extraction / eval against real Gemini |
| `apps/web` | Next.js human-in-the-loop review UI |

**Design principle (plan §8): one domain core, many thin adapters.** The CLI, the web app, and (next) the MCP server are all thin adapters over `packages/core` + `packages/db` — so a correction made via the web UI or MCP elicitation writes the *identical* audit event.

## Quick start

```bash
pnpm install
pnpm --filter @decant/db run db:generate && pnpm --filter @decant/db run db:push
echo 'GEMINI_API_KEY=...' > packages/gemini/.env   # for the live demos

pnpm test          # 59 unit/integration tests
pnpm run typecheck # all packages
```

### Demos

```bash
# 1. Extract a document (real Gemini)
pnpm --filter @decant/cli run gen-sample              # writes a synthetic receipt PNG
pnpm --filter @decant/cli run extract sample-receipt.png
pnpm --filter @decant/cli run extract sample-receipt.png --save   # also push it into the review queue
pnpm --filter @decant/cli run extract sample-receipt.png --save --ocr   # + bbox provenance via Tesseract

# 2. Eval over the gold set (real Gemini) — accuracy, ECE, safe-failure, threshold sweep
pnpm --filter @decant/cli run eval                       # full generated set (48 docs across 3 types)
pnpm --filter @decant/cli run eval --render-only         # render the gold images only (no API calls)
pnpm --filter @decant/cli run eval --type receipt --limit 8   # cost-controlled subset

# 3. Human-in-the-loop review UI
pnpm --filter @decant/web run seed
pnpm --filter @decant/web run dev    # http://localhost:3000
```

## Calibration

The eval harness **measures** calibration (ECE / reliability); the offline Python sidecar (`packages/calibrate` — the only non-TS component, batch-only) **fits** a calibrator so "0.9" becomes a real 90%. It reads the harness's `results.json`, fits **Platt + isotonic** with scikit-learn, picks the best by ECE, and emits `calibration.json` + a before/after **reliability diagram**. The TS runtime applies the fitted params (`applyCalibration` in `@decant/core`), **parity-tested** against the sidecar.

```bash
python3 -m venv packages/calibrate/.venv
packages/calibrate/.venv/bin/pip install -e packages/calibrate
# pnpm --filter @decant/cli run eval  writes reports/eval/results.json, then:
packages/calibrate/.venv/bin/python -m calibrate.fit --in reports/eval/results.json --out reports/eval/
```

The labeled gold set is **generated** (`@decant/eval` `generateGoldSet` — deterministic/seeded, PII-free) across all three registered types, with per-type renderers + image degradation (blur/rotate/low-quality JPEG) so the model's confidence actually varies. The Gemini client retries transient 429(per-minute)/5xx/network errors with backoff and **fails fast on a per-day quota**.

On a synthetic overconfident set the sidecar halves ECE (**0.245 → 0.101**). A real run over 16 generated receipts scored 100% field accuracy / 0% silent-error at ECE 0.067 — but a statistically meaningful **per-type** reliability diagram needs the full multi-type set, which exceeds the **Gemini free tier's 20 `gemini-2.5-flash` requests/day**; run `pnpm --filter @decant/cli run eval` on a paid key (or accumulate across days) to produce it.

## MCP server

Decant exposes its capabilities over the **Model Context Protocol** — `apps/mcp` is a thin adapter over the same `core` + `db` the web UI uses, so a correction made via MCP writes the **identical** audit trail. It runs over **stdio** or a **bearer-guarded Streamable HTTP** transport.

- **Tools:** `extract_document`, `list_review_queue`, `get_document`, `correct_field`, and **`review_document`** — the human-review step, delivered via **MCP elicitation**.
- **Resources:** `decant://documents/{id}`, `decant://audit/{id}`.

```bash
# drive it with the bundled demo client (stdio)
pnpm --filter @decant/mcp run client                 # list tools + review queue
pnpm --filter @decant/mcp run client <documentId>    # read its resource + review it

# or register the stdio server with an MCP host (e.g. Claude Code)
claude mcp add decant -- pnpm --filter @decant/mcp run serve

# HTTP transport (bearer-guarded, loopback): server then client
MCP_TRANSPORT=http MCP_AUTH_TOKEN=$(openssl rand -hex 16) pnpm --filter @decant/mcp run serve
MCP_SERVER_URL=http://127.0.0.1:3333/mcp MCP_AUTH_TOKEN=… pnpm --filter @decant/mcp run client
```

The marquee: when `review_document` hits a flagged field it **elicits** a structured correction from the human and records it through the same `ReviewService` as the web UI — proven by headless integration tests over **both** transports (`server.test.ts` stdio; `http-auth.test.ts` HTTP) that drive the server, auto-answer the elicitation, and assert the audit trail.

**HTTP auth & hardening** (`apps/mcp/src/auth.ts`, `http-transport.ts`): every request needs `Authorization: Bearer <MCP_AUTH_TOKEN>`, compared in **constant time** (SHA-256 + `timingSafeEqual`); missing/invalid tokens get `401` + a correct `WWW-Authenticate` challenge. The server **fails closed** (refuses to start without a token), binds to `127.0.0.1`, enables the SDK's **DNS-rebinding protection** (Host/Origin allow-lists), uses crypto-random session ids, caps the request body (1 MiB → `413`) and concurrent sessions, and reaps idle/disconnected sessions. A static shared secret is a deliberate simplification of the MCP OAuth 2.1 authorization framework — appropriate for a local tool. The transport choices were derived from the SDK source and the implementation passed an adversarial security review.

### MCP client role (consuming other servers)

Decant is also an MCP **client**: after extraction it connects OUT to external MCP servers to **enrich** and **verify** data (`packages/enrich`, bundled deterministic demo servers under `src/demo/`).

- **FX** — convert money fields into a base currency (enrichment).
- **Verification** — cross-check an extracted field against an authority. The built-in **company registry** verifier compares the registered name to the extracted `companyName`; a **mismatch routes the field to human review** — an external-source *safe failure* that feeds the same trust loop. Verdicts: `verified` (found, value matches, **and** in good standing), `mismatch`, `not_found`, `inactive` (found but dissolved), `unavailable` (source unreachable) — each with its own signal so "couldn't verify" is never mistaken for "verified". A verified match records a `<verifier>Verified` corroboration plus the answering `source` and an anchoring reference (e.g. a GLEIF LEI). Surfaced in the review UI ("External verification" panel + an honest "Why") and persisted to `Document.enrichment` with an `enriched` audit event.

```bash
pnpm --filter @decant/cli run extract sample-receipt.png --save --enrich        # deterministic demo servers
pnpm --filter @decant/cli run extract sample-receipt.png --save --enrich-live   # REAL servers (see egress below)
```

**Live mode & data egress (opt-in, OFF by default).** `--enrich-live` (or `buildEnrichment({ live: true })`) swaps the deterministic demo servers for **real** ones — `open.er-api.com` (FX, free/no-key) and **GLEIF** (`api.gleif.org`, the free global legal-entity registry). Plain `--enrich` and all tests/CI stay fully local/deterministic. What leaves the process when live:

| Provider | Sent | NOT sent |
|---|---|---|
| FX `open.er-api.com` | the source ISO **currency code** only | the amount (converted locally), the date |
| Registry `api.gleif.org` | the extracted company **legal name** | the RC number (reaches the local registry child but isn't forwarded to GLEIF's name-based API), the image, amounts, and any secrets (no `process.env`/`GEMINI_API_KEY` is forwarded to spawned children) |

**Add a verification source — implement one function.** Verification is a pluggable adapter: Decant owns the machinery (compare → verdict → route → audit); you supply a `lookup`. The company registry is itself just an instance. To add, say, a real CAC RC→name service, a tax-ID check, or a bank NUBAN→account-name check:

```ts
import { makeVerifier, fieldValue, EnrichmentService } from '@decant/enrich';

const cacVerifier = makeVerifier({
  name: 'cac',
  field: 'companyName',                               // compared + routed on failure
  applies: (doc) => !!fieldValue(doc, 'rcNumber'),    // optional gate
  lookup: async (doc) => {                            // ← the only thing you write
    const rec = await myCacApi(String(fieldValue(doc, 'rcNumber')));
    return rec ? { value: rec.name, standing: rec.status, reference: rec.rc, source: 'cac' } : null;
    // null ⇒ not_found · throw ⇒ unavailable (both route to review — never silently dropped)
  },
});
new EnrichmentService([cacVerifier /*, …other verifiers/enrichers */]);
```

`makeVerifier` handles the verdict, the standing gate, the trust-loop routing, the UI signal, and the audit entry. An MCP-backed source plugs in the same way via `mcpLookup(client, …)`.

Enrichment is **best-effort** (an unreachable server never sinks an extraction); external output is zod-validated at the boundary, the FX figure is recomputed locally from the validated rate, GLEIF results are gated on entity standing and anchored to a LEI, and connects fail fast. Integration tests spawn the demo servers over stdio (`enrich.test.ts`); network-gated tests exercise the real adapters (`live.test.ts`). The implementation passed two adversarial reviews (correctness, resource safety, security/privacy).

## Status

**Done & verified:** the trust loop end-to-end (receipts/invoices + bank statements + CAC company-registration docs), persistence + audit trail, the eval harness + a **generated multi-type gold set** (per-type renderers + image degradation) with a **resilient Gemini client** (retry/backoff, per-day-quota fast-fail), **calibration (measure → fit per-doc-type → applied in live routing)**, the review UI with **OCR-aligned bbox provenance** (each value boxed on the scan, fuzzy-matched to Tesseract tokens — so it survives OCR noise), the **MCP server** over stdio **and bearer-guarded HTTP** (elicitation-based review, security-reviewed), and the **MCP client role** with both deterministic demo servers (default) and **opt-in real adapters** (open.er-api.com FX + GLEIF registry) feeding the trust loop.

**Roadmap:** run the full per-type reliability diagram (needs a Gemini key beyond the free tier's 20 flash/day) · an official CAC (RC-number → name) registry adapter when a credentialed API is available (GLEIF stands in as a real, name-based registry today).

> The sidecar fits a **global default + per-doc-type** calibrators (`{ default, byType }`); the `ConfidenceService` loads `calibration.json` (via `DECANT_CALIBRATION` or `reports/eval/calibration.json`) and routing uses the calibrator matching each document's type (falling back to the default, then to raw scores). The full design lives in `plan.md`.

## License

[MIT](./LICENSE) © 2026 Samson Oluwafemi
