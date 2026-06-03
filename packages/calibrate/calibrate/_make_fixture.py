"""Generate a deterministic, OVERCONFIDENT results.json to demonstrate calibration.

Real calibration runs on the eval harness's results.json (`pnpm --filter @decant/cli
run eval --out ...`); this fixture just exercises the sidecar with enough points to
be meaningful (a real reliability diagram needs ~100s of field instances).
"""
import json
import sys

import numpy as np

rng = np.random.default_rng(0)
n = 300
conf = rng.uniform(0.55, 0.99, n)        # the model reports high confidence...
true_p = conf**2.2                        # ...but is actually right far less often (overconfident)
correct = (rng.random(n) < true_p).astype(int)

items = [{"confidence": round(float(c), 4), "correct": bool(k)} for c, k in zip(conf, correct)]
out = sys.argv[1] if len(sys.argv) > 1 else "results.json"
json.dump({"items": items}, open(out, "w"), indent=2)
print(f"wrote {n} items to {out}  (mean confidence {conf.mean():.3f}, mean accuracy {correct.mean():.3f})")
