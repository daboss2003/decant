"""
Offline calibration sidecar (plan §3.3/§4) — the only non-TS component, batch-only,
never on the request path.

Reads a results.json (per-field {confidence, correct}) from the TS eval harness,
fits calibrators (Platt + isotonic) on a held-out split using scikit-learn, picks
the best by ECE, and emits:
  - calibration.json : learned params + before/after ECE/Brier + a raw->calibrated
                       sample grid (so the TS runtime apply can be parity-tested)
  - reliability.png  : the before/after reliability diagram (the hero artifact)
  - metrics.json     : summary

Usage:  python -m calibrate.fit --in results.json --out outdir/
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression


def ece(conf: np.ndarray, correct: np.ndarray, n_bins: int = 10) -> float:
    conf = np.asarray(conf, dtype=float)
    correct = np.asarray(correct, dtype=float)
    if len(conf) == 0:
        return 0.0
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    total = len(conf)
    e = 0.0
    for i in range(n_bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (conf >= lo) & (conf < hi) if i < n_bins - 1 else (conf >= lo) & (conf <= hi)
        if mask.sum() == 0:
            continue
        e += (mask.sum() / total) * abs(correct[mask].mean() - conf[mask].mean())
    return float(e)


def brier(conf: np.ndarray, correct: np.ndarray) -> float:
    conf = np.asarray(conf, dtype=float)
    correct = np.asarray(correct, dtype=float)
    return float(np.mean((conf - correct) ** 2)) if len(conf) else 0.0


def sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-z))


def reliability_curve(conf: np.ndarray, correct: np.ndarray, n_bins: int = 10):
    conf = np.asarray(conf, dtype=float)
    correct = np.asarray(correct, dtype=float)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    xs, ys = [], []
    for i in range(n_bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (conf >= lo) & (conf < hi) if i < n_bins - 1 else (conf >= lo) & (conf <= hi)
        if mask.sum() == 0:
            continue
        xs.append(conf[mask].mean())
        ys.append(correct[mask].mean())
    return xs, ys


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", dest="out", required=True)
    args = ap.parse_args()

    raw = json.load(open(args.inp))
    items = raw["items"] if isinstance(raw, dict) else raw
    conf = np.array([float(x["confidence"]) for x in items], dtype=float)
    correct = np.array([1.0 if x["correct"] else 0.0 for x in items], dtype=float)
    n = len(conf)
    if n == 0:
        sys.exit("no items in results.json")

    # Held-out split: fit the calibrator on train, measure ECE on the eval split.
    rng = np.random.default_rng(0)
    idx = rng.permutation(n)
    cut = int(n * 0.7) if n >= 20 else n
    tr = idx[:cut]
    te = idx[cut:] if cut < n else idx  # tiny set: evaluate on all (with a caveat)

    candidates: dict[str, tuple[float, float]] = {}

    # Platt scaling (1-D logistic). Skip if the train split has only one class.
    platt = None
    if len(np.unique(correct[tr])) == 2:
        lr = LogisticRegression().fit(conf[tr].reshape(-1, 1), correct[tr])
        a_, b_ = float(lr.coef_[0][0]), float(lr.intercept_[0])
        platt = {"a": a_, "b": b_}
        p = sigmoid(a_ * conf[te] + b_)
        candidates["platt"] = (ece(p, correct[te]), brier(p, correct[te]))

    # Isotonic regression (non-parametric, monotonic).
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0).fit(conf[tr], correct[tr])
    iso_p = iso.predict(conf[te])
    candidates["isotonic"] = (ece(iso_p, correct[te]), brier(iso_p, correct[te]))

    chosen = min(candidates, key=lambda k: candidates[k][0])
    ece_before, brier_before = ece(conf[te], correct[te]), brier(conf[te], correct[te])
    ece_after, brier_after = candidates[chosen]

    # Sample grid of raw -> calibrated for the chosen calibrator (for TS parity tests).
    grid = np.round(np.linspace(0.0, 1.0, 21), 4)
    cal_grid = sigmoid(platt["a"] * grid + platt["b"]) if chosen == "platt" else iso.predict(grid)
    samples = [{"raw": float(r), "calibrated": round(float(c), 6)} for r, c in zip(grid, cal_grid)]

    calibration = {
        "method": chosen,
        "platt": platt,
        "isotonic": {
            "x": [float(v) for v in iso.X_thresholds_],
            "y": [float(v) for v in iso.y_thresholds_],
        },
        "eceBefore": ece_before,
        "eceAfter": ece_after,
        "brierBefore": brier_before,
        "brierAfter": brier_after,
        "n": int(n),
        "nEval": int(len(te)),
        "samples": samples,
    }

    os.makedirs(args.out, exist_ok=True)
    json.dump(calibration, open(os.path.join(args.out, "calibration.json"), "w"), indent=2)
    json.dump(
        {k: {"ece": v[0], "brier": v[1]} for k, v in candidates.items()}
        | {"raw": {"ece": ece_before, "brier": brier_before}},
        open(os.path.join(args.out, "metrics.json"), "w"),
        indent=2,
    )

    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        after = sigmoid(platt["a"] * conf[te] + platt["b"]) if chosen == "platt" else iso_p
        bx, by = reliability_curve(conf[te], correct[te])
        ax, ay = reliability_curve(np.asarray(after), correct[te])
        plt.figure(figsize=(5, 5))
        plt.plot([0, 1], [0, 1], "--", color="gray", label="perfect")
        plt.plot(bx, by, "o-", color="#e74c3c", label=f"raw (ECE {ece_before:.3f})")
        plt.plot(ax, ay, "s-", color="#2ecc71", label=f"{chosen} (ECE {ece_after:.3f})")
        plt.xlabel("mean predicted confidence")
        plt.ylabel("observed accuracy")
        plt.title("Reliability diagram — before vs after calibration")
        plt.legend()
        plt.grid(alpha=0.3)
        plt.savefig(os.path.join(args.out, "reliability.png"), dpi=120, bbox_inches="tight")
    except Exception as exc:  # noqa: BLE001
        print(f"reliability.png skipped: {exc}", file=sys.stderr)

    print(
        f"method={chosen}  ECE {ece_before:.3f} -> {ece_after:.3f}  "
        f"Brier {brier_before:.3f} -> {brier_after:.3f}  (N={n}, eval={len(te)})"
    )


if __name__ == "__main__":
    main()
