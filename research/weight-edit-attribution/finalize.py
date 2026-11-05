"""Summarize completed, frozen results and hash the research-local handoff (no model)."""
import json
import statistics
import sys

from common import HERE, sha, write_json
from memoria_engine.extractors import parse_events


def rate(value):
    return int(value.split("/")[0])


def main():
    # This file is run only after model-job completion notifications. Consume
    # the immutable snapshot recorded by the most complete score report.
    reports = [json.loads(p.read_text()) for p in (HERE / "results").glob("extract-screen-summary*.json")]
    report = max(reports, key=lambda x: (len(x), sum(v["regenerated_windows"] for v in x.values())))
    snapshot_path = HERE / next(v["cache_snapshot"] for v in report.values() if "cache_snapshot" in v)
    rows = [json.loads(line) for line in snapshot_path.read_text().splitlines()]
    prompts = {p["key"]: p for p in json.loads((HERE / "data/prompts.json").read_text())["app"]}
    baseline = json.loads((HERE / "results/baselines.json").read_text())["app"]
    summary = {}
    for condition, data in report.items():
        used = [r for r in rows if r["condition"] == condition]
        scores = data["summary"]
        selected_base = [prompts[r["original_key"]]["baseline"] for r in used]
        summary[condition] = {"qa": scores["qa_exact"], "current": scores["qa_exact_by_type"]["current"],
                              "gold": scores["tp"], "wrong_writes": scores["values"]["wrong"],
                              "proposals": scores["inbox_confirm_all"]["proposals"], "windows": len(used),
                              "new_unclean": sum(not parse_events(r["text"])[1] for r in used),
                              "base_unclean_same_windows": sum(not parse_events(r["text"])[1] for r in selected_base),
                              "seconds_total": sum(r["seconds"] for r in used),
                              "base_seconds_same_windows": sum(r["seconds"] for r in selected_base),
                              "seconds_p50": statistics.median(r["seconds"] for r in used),
                              "peak_mlx_gb": max(r["peak_gb"] for r in used),
                              "output_tokens": sum(r["output_tokens"] for r in used),
                              "strict_screen_pass": len(used) == 10 and
                                  rate(scores["qa_exact_by_type"]["current"]) > rate(baseline["qa_exact_by_type"]["current"]) and
                                  scores["tp"] >= baseline["tp"] and scores["values"]["wrong"] < baseline["values"]["wrong"]}
    diag = json.loads((HERE / "results/diagnose.json").read_text())
    edited = json.loads((HERE / "results/edit-probes.json").read_text())
    contracts = json.loads((HERE / "results/chronology-model.json").read_text())
    signed_contracts_path = HERE / "results/chronology-model-amplify.json"
    if signed_contracts_path.exists():
        extra = json.loads(signed_contracts_path.read_text())
        contracts["rows"] += extra["rows"]
        contracts["scoped_restoration"] += extra["scoped_restoration"]
        contracts["process_peak_rss_gb"] = max(contracts["process_peak_rss_gb"], extra["process_peak_rss_gb"])
    signed_probe_path = HERE / "results/amplify-probes.json"
    if signed_probe_path.exists():
        edited["summary"]["amplify--0.5"] = json.loads(signed_probe_path.read_text())["summary"]
    condition_contracts = {}
    for row in contracts["rows"]:
        condition_contracts.setdefault(row["condition"], []).append({"fixture": row["fixture"], "passed": row["passed"]})
    pair = {r["original_key"]: {} for r in rows}
    for r in rows:
        pair[r["original_key"]][r["condition"]] = r
    exact = [p for p in pair.values() if "target" in p and "random" in p]
    parity = []
    for r in rows:
        if r["condition"] == "base-regression":
            from common import harness
            old = prompts[r["original_key"]]["baseline"]["text"]
            old = harness.cut_at_repeat(old) or old
            parity.append({"original_key": r["original_key"], "byte_identical": r["text"] == old})
    peak_rss = max(diag["process_peak_gb"], edited["process_peak_gb"], contracts["process_peak_rss_gb"])
    # Completed generation jobs report macOS peak RSS in their closing line.
    for name in ("context-screen.log", "adapter-screen.log", "followup-screen.log"):
        for line in (HERE / name).read_text().splitlines():
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if record.get("closed") and "process_peak_gb" in record:
                peak_rss = max(peak_rss, record["process_peak_gb"])
    out = {"scope": "development only; selected-window extraction is open loop", "baseline": {
               "qa": baseline["qa_exact"], "current": baseline["qa_exact_by_type"]["current"], "gold": baseline["tp"],
               "wrong_writes": baseline["values"]["wrong"], "proposals": baseline["inbox_confirm_all"]["proposals"]},
           "extraction": summary, "probe_base": diag["summary"], "probe_edits": edited["summary"],
           "contract_results": condition_contracts, "source_restoration": edited["restoration_regression"],
           "ask_guard_restoration": [{"task": r["task"], "identical": r["identical"]} for r in contracts["scoped_restoration"]],
           "app_generation_parity": parity,
           "target_random_same_text": sum(p["target"]["text"] == p["random"]["text"] for p in exact),
           "target_random_paired_windows": len(exact),
           "peak_process_rss_gb": peak_rss,
           "status": "NO READY-FOR-VALIDATION CANDIDATE",
           "source_audit": "All nonzero weight conditions' apparent +1 current / +1 gold gains come from unsupported company-profit attribution in IS1008b turn 43; the random control earns the same false credit.",
           "validation_used": False, "candidate_a": "rejected by coordinator on chronology contracts; historical replay only"}
    zero = HERE / "results/zero-control.json"
    if zero.exists():
        z = json.loads(zero.read_text())
        out["zero_norm_parity"] = {k: z[k] for k in ("all_byte_identical_to_cached_base", "native_repeat_identical", "zero_equals_native")}
    target = HERE / "results/handoff.json"
    if target.exists():
        target = HERE / "results/handoff-final.json"
    write_json(target, out)
    print(json.dumps({"extraction": summary, "contracts": condition_contracts, "parity": parity}, indent=2))


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "hash":
        files = [p for p in HERE.rglob("*") if p.is_file() and p.name != "artifact-hashes.json"]
        write_json(HERE / "artifact-hashes.json", {str(p.relative_to(HERE)): sha(p.read_bytes()) for p in sorted(files)})
    else:
        main()
