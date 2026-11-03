"""Run only after the transfer job's completion notification; never polls or infers results."""
import json
import re

from qual_common import ARCHIVE, HERE, frozen, sha256, write_new_json
from context import read_jsonl
from qual_checks import decide


def main():
    plan = frozen()
    rows = read_jsonl(HERE / "results" / "transfer.jsonl")
    assert [r["condition"] for r in rows] == plan["conditions"]
    metadata = json.loads((HERE / "results" / "transfer.meta.json").read_text())
    assert metadata["plan_sha256"] == sha256((HERE / "frozen.json").read_bytes())
    for path, digest in metadata["source"].items():
        assert sha256((HERE / path).read_bytes()) == digest
    original = next(r for r in read_jsonl(ARCHIVE / "results" / "baseline-r1.jsonl") if r["id"] == plan["prompt_id"])
    for row in rows:
        assert row["prompt_sha256"] == plan["prompt_sha256"]
        assert row["rendered_prompt_sha256"] == original["rendered_prompt_sha256"]
        if row["patch"]:
            assert row["patch"]["strength"] == 2
            assert row["patch"]["direction_sha256"] == plan["edit"]["direction_sha256"]
    decision = decide(rows)
    assert decision == json.loads((HERE / "results" / "transfer_decision.json").read_text())
    log = (HERE / "results" / "transfer.log").read_text()
    duration = re.search(r"(?m)^\s*(\d+(?:\.\d+)?)\s+real\s", log)
    footprint = re.search(r"(\d+)\s+peak memory footprint", log)
    assert duration and footprint and "Traceback (most recent call last)" not in log
    assert float(duration[1]) < 480
    summary = []
    for row in rows:
        baseline_events = set(rows[0]["audit"]["quality"]["unique_valid"])
        current_events = set(row["audit"]["quality"]["unique_valid"])
        summary.append({"condition": row["condition"], "tokens": row["output_tokens"], "seconds": row["seconds"],
                        "finish_reason": row["finish_reason"], "natural_eos": row["natural_eos"],
                        "strict_raw_json": row["audit"]["strict_raw_schema"], "raw_equals_returned": row["raw_text"] == row["text"],
                        "nonempty_events": row["audit"]["nonempty_events"],
                        "source_controls": row["audit"]["source_control_hits"],
                        "unique_parsed_count": len(row["audit"]["unique_parsed"]),
                        "source_grounded_core_count": len(row["audit"]["source_grounded_cores"]),
                        "valid_count": len(current_events), "gold_hits": row["audit"]["quality"]["gold_hits"],
                        "newly_valid_for_manual_source_audit": sorted(current_events - baseline_events),
                        "premerge_wrong_value_candidates": row["audit"]["premerge_wrong_value_candidates"],
                        "byte_matches_historical": row["matches_historical_bytes"],
                        "token_ids_match_archived_base": row["token_ids"] == original["token_ids"],
                        "peak_mlx_gb": row["peak_mlx_gb"], **row["versus_before"]})
    record = {"scope": "one independently frozen literal-loop prompt; bracketed base/edit/random/base, no population p95 claim",
              "decision": decision, "conditions": summary,
              "resource": {"process_seconds": float(duration[1]), "peak_footprint_gb": int(footprint[1]) / 1e9,
                           "max_mlx_gb": max(r["peak_mlx_gb"] for r in rows), "allocator_cache_mib": 256},
              "archive_preserved": True, "newval_generation_or_scoring": False}
    write_new_json(HERE / "results" / "transfer_audit.json", record)
    print(json.dumps(record, indent=2))


if __name__ == "__main__":
    main()
