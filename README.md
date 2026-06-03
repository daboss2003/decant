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
pnpm --filter @decant/cli run eval

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

On a synthetic overconfident set this halves ECE (**0.245 → 0.101**). A meaningful real reliability diagram needs ~100s of labeled field instances (grow the gold set).

## MCP server

Decant exposes its capabilities over the **Model Context Protocol** — `apps/mcp` is a thin stdio adapter over the same `core` + `db` the web UI uses, so a correction made via MCP writes the **identical** audit trail.

- **Tools:** `extract_document`, `list_review_queue`, `get_document`, `correct_field`, and **`review_document`** — the human-review step, delivered via **MCP elicitation**.
- **Resources:** `decant://documents/{id}`, `decant://audit/{id}`.

```bash
# drive it with the bundled demo client
pnpm --filter @decant/mcp run client                 # list tools + review queue
pnpm --filter @decant/mcp run client <documentId>    # read its resource + review it

# or register the stdio server with an MCP host (e.g. Claude Code)
claude mcp add decant -- pnpm --filter @decant/mcp run serve
```

The marquee: when `review_document` hits a flagged field it **elicits** a structured correction from the human and records it through the same `ReviewService` as the web UI — proven by a headless integration test (`apps/mcp/src/server.test.ts`) that spawns the server, auto-answers the elicitation, and asserts the audit trail.

## Status

**Done & verified:** the trust loop end-to-end (receipts/invoices + bank statements + CAC company-registration docs), persistence + audit trail, the eval harness, **calibration (measure → fit per-doc-type → applied in live routing)**, the review UI with **OCR-aligned bbox provenance** (each value boxed on the scan, fuzzy-matched to Tesseract tokens — so it survives OCR noise), and the **MCP server + client** (elicitation-based review).

**Roadmap:** a larger labeled gold set (for a statistically meaningful per-type diagram) · auth · MCP client-role enrichment (registry/FX lookups).

> The sidecar fits a **global default + per-doc-type** calibrators (`{ default, byType }`); the `ConfidenceService` loads `calibration.json` (via `DECANT_CALIBRATION` or `reports/eval/calibration.json`) and routing uses the calibrator matching each document's type (falling back to the default, then to raw scores). The full design lives in `plan.md`.

## License

[MIT](./LICENSE) © 2026 Samson Oluwafemi
