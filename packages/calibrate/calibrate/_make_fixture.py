"""Generate a deterministic, OVERCONFIDENT results.json to demonstrate calibration.

Real calibration runs on the eval harness's results.json (`pnpm --filter @decant/cli
run eval --out ...`); this fixture just exercises the sidecar with enough points to
be meaningful (a real reliability diagram needs ~100s of field instances).
"""
import json
import sys

import numpy as np

rng = np.random.default_rng(0)


def make(n: int, doc_type: str, bias: float) -> list[dict]:
    """Miscalibrated points for one type: true accuracy = conf**bias (bias>1 ⇒ overconfident)."""
    conf = rng.uniform(0.55, 0.99, n)
    correct = (rng.random(n) < conf**bias).astype(int)
    return [
        {"confidence": round(float(c), 4), "correct": bool(k), "docType": doc_type}
        for c, k in zip(conf, correct)
    ]


# Two types with DIFFERENT miscalibration → per-type calibrators should beat one global fit.
items = make(160, "receipt", 2.2) + make(160, "bank_statement", 1.4)
out = sys.argv[1] if len(sys.argv) > 1 else "results.json"
json.dump({"items": items}, open(out, "w"), indent=2)
print(f"wrote {len(items)} items to {out}  (receipt: overconfident, bank_statement: mildly overconfident)")
