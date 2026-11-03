"""Compare actual predictions/timings with the actual base, keeping losses explicit."""
import argparse
import json

from context import HERE, read_jsonl, write_new_json
from quality import compare_quality


def percentile(values, p):
    values = sorted(values)
    at = (len(values) - 1) * p
    low, high = int(at), min(int(at) + 1, len(values) - 1)
    return round(values[low] + (values[high] - values[low]) * (at - low), 4)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("labels", nargs="+")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    baseline = {r["id"]: r for r in read_jsonl(HERE / "results" / "baseline-r1.jsonl")}
    summaries, detail = [], []
    for label in args.labels:
        rows = read_jsonl(HERE / "results" / (label + ".jsonl"))
        compared = []
        for row in rows:
            base = baseline[row["id"]]
            quality = compare_quality(base["quality"], row["quality"])
            compared.append({"id": row["id"], "role": row["role"], "seconds": row["seconds"],
                             "baseline_seconds": base["seconds"], "tokens": row["output_tokens"],
                             "baseline_tokens": base["output_tokens"], "early_stopped": row["early_stopped"],
                             "raw_is_baseline_prefix": base["raw_text"].startswith(row["raw_text"]),
                             "bytes_equal": row["text"] == base["text"], "raw_clean": row["raw_clean"],
                             "returned_clean": row["quality"]["parsed_cleanly"], **quality})
        normals = [r for r in compared if "normal" in r["role"]]
        sums = {"label": label, "n": len(rows), "seconds": round(sum(r["seconds"] for r in rows), 3),
                "baseline_seconds_same_prompts": round(sum(baseline[r["id"]]["seconds"] for r in rows), 3),
                "output_tokens": sum(r["output_tokens"] for r in rows),
                "hit_budget": sum(r["hit_budget"] for r in rows),
                "repetitive_caps": sum(r["hit_budget"] and bool(r["repeat_detected"]) for r in rows),
                "returned_unclean": sum(not r["quality"]["parsed_cleanly"] for r in rows),
                "raw_unclean": sum(not r["raw_clean"] for r in rows),
                "p50_seconds": percentile([r["seconds"] for r in rows], .5),
                "p95_seconds": percentile([r["seconds"] for r in rows], .95),
                "baseline_p95_same_prompts": percentile([baseline[r["id"]]["seconds"] for r in rows], .95),
                "lost_gold_candidate_matches": sum(len(r["lost_gold"]) for r in compared),
                "added_gold_candidate_matches": sum(len(r["added_gold"]) for r in compared),
                "lost_unique_valid": sum(len(r["lost_unique_valid"]) for r in compared),
                "normal_byte_equal": f"{sum(r['bytes_equal'] for r in normals)}/{len(normals)}",
                "peak_mlx_gb": max(r["peak_mlx_gb"] for r in rows)}
        summaries.append(sums)
        detail.append({"label": label, "prompts": compared})
    result = {"caveats": ["Latency is measured, not token-ratio simulation; diagnostic is failure-enriched.",
                          "Per-window gold candidate matches precede WindowedExtractor deduplication and are not full-pipeline TP.",
                          "Grounded baseline candidates can be wrong; report losses alongside gold and inspect semantic changes."],
              "summary": summaries, "detail": detail}
    write_new_json(HERE / "results" / args.out, result)
    print(json.dumps(summaries, indent=2))


if __name__ == "__main__":
    main()
