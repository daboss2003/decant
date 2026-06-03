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


MIN_PER_TYPE = 40  # need enough points per type to fit + hold out an eval split


def fit_one(conf: np.ndarray, correct: np.ndarray):
    """Fit Platt + isotonic on a held-out split; return (calibration_dict, summary)."""
    n = len(conf)
    rng = np.random.default_rng(0)
    idx = rng.permutation(n)
    cut = int(n * 0.7) if n >= 20 else n
    tr = idx[:cut]
    te = idx[cut:] if cut < n else idx

    candidates: dict[str, tuple[float, float]] = {}
    platt = None
    if len(np.unique(correct[tr])) == 2:
        lr = LogisticRegression().fit(conf[tr].reshape(-1, 1), correct[tr])
        a_, b_ = float(lr.coef_[0][0]), float(lr.intercept_[0])
        platt = {"a": a_, "b": b_}
        p = sigmoid(a_ * conf[te] + b_)
        candidates["platt"] = (ece(p, correct[te]), brier(p, correct[te]))

    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0).fit(conf[tr], correct[tr])
    candidates["isotonic"] = (ece(iso.predict(conf[te]), correct[te]), brier(iso.predict(conf[te]), correct[te]))

    chosen = min(candidates, key=lambda k: candidates[k][0])
    ece_before, brier_before = ece(conf[te], correct[te]), brier(conf[te], correct[te])
    ece_after, brier_after = candidates[chosen]

    grid = np.round(np.linspace(0.0, 1.0, 21), 4)
    cal_grid = sigmoid(platt["a"] * grid + platt["b"]) if chosen == "platt" else iso.predict(grid)

    calibration = {
        "method": chosen,
        "platt": platt,
        "isotonic": {"x": [float(v) for v in iso.X_thresholds_], "y": [float(v) for v in iso.y_thresholds_]},
        "eceBefore": ece_before,
        "eceAfter": ece_after,
        "brierBefore": brier_before,
        "brierAfter": brier_after,
        "n": int(n),
        "nEval": int(len(te)),
        "samples": [{"raw": float(r), "calibrated": round(float(c), 6)} for r, c in zip(grid, cal_grid)],
    }
    return calibration, {"method": chosen, "eceBefore": ece_before, "eceAfter": ece_after, "n": int(n)}


def reliability_png(out: str, conf: np.ndarray, correct: np.ndarray, cal: dict) -> None:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        rng = np.random.default_rng(0)
        idx = rng.permutation(len(conf))
        cut = int(len(conf) * 0.7) if len(conf) >= 20 else len(conf)
        tr, te = idx[:cut], (idx[cut:] if cut < len(conf) else idx)
        if cal["method"] == "platt":
            after = sigmoid(cal["platt"]["a"] * conf[te] + cal["platt"]["b"])
        else:
            iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0).fit(conf[tr], correct[tr])
            after = iso.predict(conf[te])
        bx, by = reliability_curve(conf[te], correct[te])
        ax, ay = reliability_curve(np.asarray(after), correct[te])
        plt.figure(figsize=(5, 5))
        plt.plot([0, 1], [0, 1], "--", color="gray", label="perfect")
        plt.plot(bx, by, "o-", color="#e74c3c", label=f"raw (ECE {cal['eceBefore']:.3f})")
        plt.plot(ax, ay, "s-", color="#2ecc71", label=f"{cal['method']} (ECE {cal['eceAfter']:.3f})")
        plt.xlabel("mean predicted confidence")
        plt.ylabel("observed accuracy")
        plt.title("Reliability diagram — global, before vs after")
        plt.legend()
        plt.grid(alpha=0.3)
        plt.savefig(os.path.join(out, "reliability.png"), dpi=120, bbox_inches="tight")
    except Exception as exc:  # noqa: BLE001
        print(f"reliability.png skipped: {exc}", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", dest="out", required=True)
    args = ap.parse_args()

    raw = json.load(open(args.inp))
    items = raw["items"] if isinstance(raw, dict) else raw
    if not items:
        sys.exit("no items in results.json")
    conf = np.array([float(x["confidence"]) for x in items], dtype=float)
    correct = np.array([1.0 if x["correct"] else 0.0 for x in items], dtype=float)
    types = [str(x.get("docType", "")) for x in items]

    default_cal, default_sum = fit_one(conf, correct)

    by_type: dict[str, dict] = {}
    per_type_summary: dict[str, dict] = {}
    for t in sorted(set(types)):
        if not t:
            continue
        mask = np.array([ty == t for ty in types])
        if mask.sum() >= MIN_PER_TYPE and len(np.unique(correct[mask])) == 2:
            cal, summ = fit_one(conf[mask], correct[mask])
            by_type[t] = cal
            per_type_summary[t] = summ

    os.makedirs(args.out, exist_ok=True)
    json.dump({"default": default_cal, "byType": by_type}, open(os.path.join(args.out, "calibration.json"), "w"), indent=2)
    json.dump({"default": default_sum, "byType": per_type_summary}, open(os.path.join(args.out, "metrics.json"), "w"), indent=2)
    reliability_png(args.out, conf, correct, default_cal)

    print(f"global: method={default_sum['method']} ECE {default_sum['eceBefore']:.3f} -> {default_sum['eceAfter']:.3f} (N={default_sum['n']})")
    for t, s in per_type_summary.items():
        print(f"  {t}: method={s['method']} ECE {s['eceBefore']:.3f} -> {s['eceAfter']:.3f} (N={s['n']})")
    skipped = [t for t in sorted(set(types)) if t and t not in by_type]
    if skipped:
        print(f"  (per-type skipped, < {MIN_PER_TYPE} pts -> use default): {', '.join(skipped)}")


if __name__ == "__main__":
    main()
