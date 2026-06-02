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

# 2. Eval over the gold set (real Gemini) — accuracy, ECE, safe-failure, threshold sweep
pnpm --filter @decant/cli run eval

# 3. Human-in-the-loop review UI
pnpm --filter @decant/web run seed
pnpm --filter @decant/web run dev    # http://localhost:3000
```

## Status

**Done & verified:** the trust loop end-to-end (receipts/invoices + bank statements), persistence + audit trail, the eval harness, and the review UI.

**Roadmap:** MCP server + client (§8, in progress) · calibration fitting (Python sidecar) · OCR-aligned bbox provenance · CAC document type · auth.

> Confidence scores are currently **uncalibrated** (raw fusion) — "0.9" is not yet "right 90% of the time." Calibration is the next measurement→fit step. The full design lives in `plan.md`.
