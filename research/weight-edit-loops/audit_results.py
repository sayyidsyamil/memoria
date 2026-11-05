"""CPU-only resource and final-structural prediction audit after all job notifications."""
import json
import re

from context import HERE, read_jsonl, write_new_json
from quality import compare_quality

LOGS = ("baseline-r1", "online-stop-r1", "activation-probe", "contrast-screen", "recovery-base",
        "patch-verification", "causal-grid", "recovery-strict-root", "patch-verification-fp32",
        "contrast-strong", "sparse-strong", "conservative-paired", "gate-causal",
        "structural-derivation", "structural-screen")


def main():
    resources = []
    for name in LOGS:
        text = (HERE / "results" / (name + ".log")).read_text()
        wall = re.search(r"(?m)^\s*(\d+(?:\.\d+)?)\s+real\s", text)
        footprint = re.search(r"(\d+)\s+peak memory footprint", text)
        assert wall and footprint and "Traceback (most recent call last)" not in text, name
        resources.append({"job": name, "process_seconds": float(wall[1]), "peak_footprint_gb": int(footprint[1]) / 1e9})
    assert max(r["process_seconds"] for r in resources) < 480
    write_new_json(HERE / "results" / "resource_audit.json", {
        "jobs": resources, "n_completed_jobs": len(resources),
        "total_process_seconds": sum(r["process_seconds"] for r in resources),
        "max_job_seconds": max(r["process_seconds"] for r in resources),
        "max_footprint_gb": max(r["peak_footprint_gb"] for r in resources),
        "scope": "completed model leases; external lock wait is excluded; each command used run-exclusive.py"})
    baseline = {r["id"]: r for r in read_jsonl(HERE / "results" / "baseline-r1.jsonl")}
    predictions = []
    for suffix in ("s2", "s4", "random_output_s4"):
        path = HERE / "results" / f"structural-screen-structural_layer31_{suffix}.jsonl"
        rows = read_jsonl(path)
        assert len(rows) == 2
        for row in rows:
            base = baseline[row["id"]]
            before = {json.dumps(e, sort_keys=True) for e in base["quality"]["events"]}
            after = {json.dumps(e, sort_keys=True) for e in row["quality"]["events"]}
            predictions.append({"condition": suffix, "id": row["id"], "output_tokens": row["output_tokens"],
                                "seconds": row["seconds"], "finish_reason": row["finish_reason"],
                                "early_stopped": row["early_stopped"], "raw_clean": row["raw_clean"],
                                "raw_equals_returned": row["raw_text"] == row["text"],
                                "baseline_unique_parsed_events": len(before), "returned_unique_parsed_events": len(after),
                                "lost_unique_parsed_events": len(before - after),
                                "normal_bytes_equal": row["text"] == base["text"] if "normal" in row["role"] else None,
                                **compare_quality(base["quality"], row["quality"])})
    result = {"scope": "final static arm, derivation pair only; timings not an interleaved base/edit population comparison",
              "predictions": predictions,
              "qualification": "not qualified: independent dev, recovery and cross-task gates were not run before the user closed this bounded study",
              "validation_generation_or_scoring": False}
    write_new_json(HERE / "results" / "structural_final_audit.json", result)
    print(json.dumps({"resources": {"jobs": len(resources), "max_seconds": max(r["process_seconds"] for r in resources),
                                    "max_footprint_gb": max(r["peak_footprint_gb"] for r in resources)},
                      "structural": predictions}, indent=2))


if __name__ == "__main__":
    main()
