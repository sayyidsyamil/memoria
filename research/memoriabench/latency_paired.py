"""Supplementary latency measurement for the topic-scoping experiment (NOT pre-registered; it answers one question the batch runs cannot).

The batch runs measured M3 and M2 one after the other, so anything that changed in between (what else the Mac was doing, heat) lands on one
system only. Here both systems answer each probe in ONE process, one right after the other, and the order alternates from probe to probe, so
that whatever slows the Mac slows both alike. The labels are not used: the predictions of the batch runs are the results; only the times are.

    python3.11 latency_paired.py --condition C0 --probes 112
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

import run_benchmarks as R
import run_scoping as RS
import scoping_report as P

OUT = RS.OUT / "_paired"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--condition", choices=("C0", "C1", "C2"), required=True)
    parser.add_argument("--probes", type=int, default=112, help="an evenly spaced sample of the 336 probes")
    args = parser.parse_args(argv)
    if busy := RS.busy_model_processes():
        print(f"refused: {busy} holds a model", file=sys.stderr)
        return 1
    config = json.loads(RS.CONFIG.read_text(encoding="utf-8"))
    memories = RS.condition_memories(args.condition, "test")
    probes = R.pick_probes(R.read_lines(R.BENCH_FILE), args.probes)
    m2 = RS.Unscoped(args.condition, "test", memories, config)
    m3 = RS.Scoped(args.condition, "test", memories, config)
    for runner in (m3, m2):
        runner.predict(probes[0]["series_id"], "Let us get started, everyone.")
    rows = {"M3": [], "M2": []}
    for number, probe in enumerate(probes):
        order = (("M3", m3), ("M2", m2)) if number % 2 == 0 else (("M2", m2), ("M3", m3))
        for kind, runner in order:
            started = time.perf_counter()
            result = runner.predict(probe["series_id"], probe["statement"])
            milliseconds = (time.perf_counter() - started) * 1000
            rows[kind].append({"id": probe["id"], "series_id": probe["series_id"], "system": f"{kind}@{args.condition}", "pred": result["pred"], "latency_ms": round(milliseconds, 2), "first": order[0][0] == kind})
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{args.condition}.jsonl").write_text("".join(json.dumps(r) + "\n" for kind in rows for r in rows[kind]), encoding="utf-8")
    ratio = P.latency_ratio(rows["M3"], rows["M2"])
    diff = np.array([a["latency_ms"] - b["latency_ms"] for a, b in zip(rows["M3"], rows["M2"])])
    first = lambda kind, flag: float(np.median([r["latency_ms"] for r in rows[kind] if r["first"] == flag]))
    summary = {"condition": args.condition, "probes": len(probes), "p50_ms": {k: float(np.median([r["latency_ms"] for r in v])) for k, v in rows.items()},
               "p95_ms": {k: float(np.percentile([r["latency_ms"] for r in v], 95)) for k, v in rows.items()}, "ratio_of_medians": ratio, "median_paired_difference_ms": float(np.median(diff)),
               "share_of_probes_where_m3_was_faster": float((diff < 0).mean()), "median_when_first_ms": {k: first(k, True) for k in rows}, "median_when_second_ms": {k: first(k, False) for k in rows},
               "same_label_as_batch_run": {}}
    for kind in rows:
        batch = {r["id"]: r for r in R.read_lines(RS.OUT / "_work" / f"{kind}@{args.condition}.jsonl")}
        summary["same_label_as_batch_run"][kind] = f"{sum(r['pred'] == batch[r['id']]['pred'] for r in rows[kind])}/{len(rows[kind])}"
    (OUT / f"{args.condition}.summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
