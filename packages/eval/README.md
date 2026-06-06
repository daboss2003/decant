# @decant/eval

> Offline gold-set generation + calibration scoring for the Decant pipeline.

**What it's for** — This is the OFFLINE evaluation harness, not a production dependency. It generates a deterministic, PII-free synthetic gold set across Decant's three doc types, scores the real pipeline's output against the labels with kind-aware field matchers, and computes the success-criteria metrics (ECE, Brier, reliability bins, silent/safe-failure rates). It exists so calibration can be *measured*: it emits the `results.json` that the Python [`packages/calibrate`](../calibrate) sidecar fits a calibrator against. Consumed only by the [`apps/cli`](../../apps/cli) `eval` command.

## Public API
- `generateGoldSet(opts?)` — deterministic seeded synthetic gold; per-type counts via `{ seed, receipts, bankStatements, cac }`.
- `RECEIPT_GOLD` — small hand-written 3-receipt static gold set (`--static` mode).
- `evaluate(cases)` — score `EvalCase[]` (gold + pipeline `DocumentResult`) into an `EvalReport`.
- `matchField(kind, expected, predicted, opts?)` / `stringSimilarity(a, b)` — kind-aware matchers (`money`/`date`/`currency`/`id`/`string`/…) reusing core normalizers.
- `renderReport(report)` — render an `EvalReport` as readable text (headline + reliability + τ-sweep tables).
- Metrics: `ece`, `brier`, `reliabilityBins`, `silentErrorRate`, `safeFailureRate`, `fieldAccuracy`, `autoApproveFraction`, `thresholdSweep`.
- Types: `GoldDoc`, `GoldField`, `EvalCase`, `EvalReport`, `PerFieldResult`, `GeneratedGoldDoc`, `Difficulty`, `MatchKind`, `Scored`, `ReliabilityBin`, `SweepPoint`.

## How it's used
Driven by the CLI `eval` script (`apps/cli` → `tsx src/eval.ts`); the harness ingests gold, runs the real pipeline, scores, and writes `results.json`:

```ts
import { generateGoldSet, evaluate, renderReport, type EvalCase } from '@decant/eval';

const gold = generateGoldSet({ seed: 42, receipts: 24, bankStatements: 12, cac: 12 });
// ...render each gold doc to an image, run the pipeline, pair gold + predicted DocumentResult...
const cases: EvalCase[] = [{ gold, predicted /* DocumentResult */ }];
const report = evaluate(cases);
console.log(renderReport(report));        // headline + reliability + threshold-sweep tables
// CLI then writes report.perField → reports/eval/results.json for the calibrate sidecar
```

Run it: `pnpm --filter @decant/cli eval` (flags: `--static`, `--seed N`, `--receipts/--bank/--cac N`, `--type`, `--limit`, `--gold-dir <dir>`, `--render-only [dir]`).

This package itself reads no env vars; the CLI requires `GEMINI_API_KEY` (see [`packages/gemini`](../gemini)) to run the actual extraction during eval.

## Depends on
- [`@decant/core`](../core) — its only dependency: `DocumentResult`/`FieldStatus` types and the shared `toMinor`/`normalizeDate`/`normalizeCurrency` normalizers, so eval and runtime score against one source of truth.

## Notes
- Offline-only. NOT imported by `apps/api` or `apps/mcp`; keep it out of the production import graph.
- `generateGoldSet` is fully deterministic for a given `seed` (mulberry32 PRNG) — same seed, same set.
- `Difficulty` (`clean`/`noisy`/`hard`) is a *rendering* hint to spread model confidence; it is ignored by scoring.
- `matchField` treats a null expected as a valid answer — predicting a value there counts as a fabrication (false). `id` matches are exact; `money` allows ±1 minor unit.
- Gold values are GROUND TRUTH; the CLI renders images from them, degrades per `difficulty`, then scores the pipeline output.

Tests: `packages/eval/test/` — run `pnpm test` from the repo root.
