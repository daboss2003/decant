# decant-calibrate
> Offline Python sidecar that fits Decant's confidence calibrator (Platt / isotonic).

**What it's for** — Decant scores a raw per-field confidence; this batch tool turns those raw scores into *calibrated* probabilities so "0.9" really means ~90% correct. It reads the eval harness's `results.json`, fits both a Platt (logistic) and an isotonic calibrator on a held-out split, keeps whichever has the lower ECE, and writes the learned params for the TS runtime to apply. It is the **only non-TS component** in the repo, is **batch-only, and never runs on the request path** — the live system just loads its JSON output.

## Commands
This is a Python package (`pyproject.toml`, no pnpm scripts). The one entrypoint:

- `python -m calibrate.fit --in <results.json> --out <outdir>/` — fit + emit artifacts.
- `python -m calibrate._make_fixture <out.json>` — generate a deterministic, overconfident demo `results.json` (two doc types) to exercise the sidecar without a real eval run.

`fit` writes three files into `--out`:
- `calibration.json` — `{ default, byType }` calibrators (method, Platt/isotonic params, before/after ECE+Brier, and a 21-point `raw→calibrated` sample grid for parity testing).
- `metrics.json` — per-fit summary (chosen method, ECE before/after, N).
- `reliability.png` — before/after reliability diagram (the hero artifact).

## How it's used
```bash
# from packages/calibrate/, with the venv active
python -m venv .venv && source .venv/bin/activate
pip install -e .
# real input comes from the TS eval harness:
#   pnpm --filter @decant/cli run eval --out reports/eval/
python -m calibrate.fit --in ../../reports/eval/results.json --out ../../reports/eval/
```
The TS side then **applies** the emitted params at runtime — [`packages/db`](../db/src/calibration-config.ts)'s `loadCalibration()` reads `calibration.json` (path overridable via `DECANT_CALIBRATION`, default `../../reports/eval/calibration.json`) and [`packages/core`](../core/src/calibration.ts)'s `applyCalibration()` / `resolveCalibration()` map raw confidence → calibrated probability. Golden-vector parity with this sidecar is enforced by `packages/core/test/calibration.test.ts` against the `samples` grid.

**Env vars:** none required by this package. (The TS consumer reads `DECANT_CALIBRATION` to locate `calibration.json`.)

## Depends on
- `numpy>=2`, `scikit-learn>=1.5` (LogisticRegression for Platt, IsotonicRegression for isotonic), `matplotlib>=3.8` (reliability PNG; gracefully skipped if it fails). Requires Python ≥3.11.
- No `@decant/*` deps — it is decoupled, talking to the rest of Decant only through `results.json` in and `calibration.json` out.

## Notes
- **Per-type calibration:** a separate calibrator is fit per `docType` only when that type has ≥ `MIN_PER_TYPE` (40) points and both labels present; otherwise that type falls back to `default`.
- **The split is seeded** (`np.random.default_rng(0)`, 70/30) so fits are reproducible. With < 20 points it trains and evaluates on the full set.
- **Parity is sacred:** the TS `applyIsotonic` is piecewise-linear with clipping to match sklearn's `IsotonicRegression(out_of_bounds='clip')`. If you change the fit math here, regenerate the core fixture or the parity test will fail.
- **Not on the request path:** run this offline; production reads only the JSON.

Tests: parity is verified on the TS side — `packages/core/test/calibration.test.ts` (run `pnpm test` from the repo root).
