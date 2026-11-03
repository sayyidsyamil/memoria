"""Post-diagnostic geometry only; never selects another edit from check-set results."""
import json

import numpy as np

from common import HERE, SCRATCH, write_json
from experiment import LAYERS, auc


def unit(x):
    return x / np.linalg.norm(x)


def main():
    cases = json.loads((HERE / "data/cases.json").read_text())
    old = [c for c in cases if c["split"] == "derive"]
    acts = np.load(SCRATCH / "activations.npz")
    attribution = {"a03", "a04", "a05", "a06"}
    status = {"a00", "a01", "a02", "a07"}
    rows = []
    for layer in LAYERS:
        h = lambda c: acts[f"{c['id']}_h{layer}"]
        pos = np.mean([h(c) for c in old if c["expected_support"]], axis=0)
        da = unit(np.mean([h(c) for c in old if c["id"] in attribution], axis=0)-pos)
        ds = unit(np.mean([h(c) for c in old if c["id"] in status], axis=0)-pos)
        d = unit(np.mean([h(c) for c in old if not c["expected_support"]], axis=0)-pos)
        by_series = {}
        for name in ("ES2003", "TS3004", "ES2011", "IS1008", "TS3006"):
            part = [c for c in cases if c["series"] == name]
            by_series[name] = auc([not c["expected_support"] for c in part], [float(h(c) @ d) for c in part])
        rows.append({"layer": layer, "attribution_vs_status_direction_cosine": float(da @ ds), "auc_by_series": by_series})
    arr = np.load(HERE / "data/rank-one-patch.npz")
    u = arr["u"]
    write_json(HERE / "results/direction-geometry.json", {
        "not_for_selection": True, "rows": rows, "u_largest_coordinate": float(np.max(np.abs(u))),
        "u_top32_energy": float(np.sort(u*u)[-32:].sum()), "u_effective_dimensions": float(1/np.sum(u**4)),
        "delta_norm_half": .5*float(np.linalg.norm(arr["p"])),
        "random_delta_norm_half": .5*float(np.linalg.norm(np.outer(arr["random_u"], arr["p"]))),
        "label_caveat": "Informal tentative/accepted language is inherently ambiguous. Frozen labels and intervention selection are unchanged; these are manually source-judged diagnostics, not human-adjudicated gold."})
    print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()
