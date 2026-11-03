"""Source-level handoff from immutable model-output snapshots, never gold-window matching."""
import json
import statistics

from r2_common import HERE, R1, sha, verify_round1, write_json


def aggregate(rows):
    return {"cases": len(rows), "success": sum(r["success"] for r in rows),
            **{k: sum(r[k] for r in rows) for k in ("expected", "found", "wrong_writes", "invalid", "ungrounded", "tokens")},
            "unclean": sum(not r["parsed_cleanly"] for r in rows),
            "seconds": sum(r["seconds"] for r in rows),
            "p50_seconds": statistics.median(r["seconds"] for r in rows) if rows else None,
            "peak_mlx_gb": max((r["peak_gb"] for r in rows), default=0)}


def main():
    cases = {c["id"]: c for c in json.loads((HERE / "data/cases.json").read_text())}
    reports = [json.loads(p.read_text()) for p in (HERE / "results").glob("generation-summary-*.json")]
    report = max(reports, key=lambda r: len(r["cases"]))
    all_rows = report["cases"]
    base = {r["id"]: r for r in all_rows if r["condition"] == "base"}
    comparisons = {}
    for condition in sorted({r["condition"] for r in all_rows}):
        rows = [r for r in all_rows if r["condition"] == condition]
        matched = [base[r["id"]] for r in rows]
        flips = [{"id": r["id"], "base_success": base[r["id"]]["success"], "success": r["success"],
                  "base_found": base[r["id"]]["found"], "found": r["found"],
                  "base_wrong": base[r["id"]]["wrong_writes"], "wrong": r["wrong_writes"]} for r in rows
                 if (r["success"], r["found"], r["wrong_writes"]) != (base[r["id"]]["success"], base[r["id"]]["found"], base[r["id"]]["wrong_writes"])]
        a, b = aggregate(rows), aggregate(matched)
        comparisons[condition] = {"result": a, "matched_base": b, "changes": flips,
            "passes_source_gate": a["found"] >= b["found"] and a["wrong_writes"] < b["wrong_writes"] and
                all(r["found"] >= base[r["id"]]["found"] for r in rows) and a["invalid"] <= b["invalid"] and a["unclean"] <= b["unclean"]}
    native = json.loads((HERE / "results/native.json").read_text())
    ranks = {}
    for split in ("derive", "check"):
        ranks[split] = {}
        for group in ("dual", "single_case", "single_untracked"):
            part = [r for r in native["rows"] if r["split"] == split and (
                (group == "dual" and r["dual_tracked"]) or (group == "single_case" and not r["dual_tracked"] and r["expected"] is not None)
                or (group == "single_untracked" and not r["dual_tracked"] and r["expected"] is None))]
            ranks[split][group] = {"correct_full_sequence_rank": sum(r["correct"] for r in part), "n": len(part),
                                   "margins": [r["margin"] for r in part]}
    contracts = json.loads((HERE / "results/contracts.json").read_text())
    extra = HERE / "results/contracts-shadow.json"
    if extra.exists():
        contracts["rows"] += json.loads(extra.read_text())["rows"]
    result = {"scope": "short source-matched native extraction fixtures; not full-dev QA or final validation",
              "round1_hashes_match": verify_round1(), "case_sha256": sha((HERE / "data/cases.json").read_bytes()),
              "native_ranks": ranks, "localization": native["localization"], "weights_modified": False,
              "comparisons": comparisons, "contracts": [{k: r[k] for k in ("condition", "fixture", "passed", "actual")} for r in contracts["rows"]],
              "generation_snapshot": report["snapshot"], "generation_snapshot_sha256": report["snapshot_sha256"],
              "final_validation_used": False}
    path = HERE / f"results/handoff-{report['snapshot_sha256'][:12]}.json"
    write_json(path, result)
    print(json.dumps({"handoff": str(path), "comparisons": comparisons, "native": ranks}, indent=2))


if __name__ == "__main__":
    main()
