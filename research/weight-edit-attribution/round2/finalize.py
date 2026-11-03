"""Final bounded round-2 audit and immutable handoff. No model is loaded."""
import ast
import json
import math
import statistics
import subprocess
import sys

from r2_common import HERE, R1, load_dev, sha, verify_round1, write_json
from generation import effective_text, registry, score_output, shadow_prompt
from summarize import aggregate


def read_json(path):
    return json.loads(path.read_text())


def main():
    hashes = verify_round1()
    cases = {c["id"]: c for c in read_json(HERE / "data/cases.json")}
    freeze = read_json(HERE / "data/freeze.json")
    assert sha((HERE / "data/cases.json").read_bytes()) == freeze["case_sha256"]
    for path in HERE.glob("*.py"):
        ast.parse(path.read_text(), filename=str(path))
    native = read_json(HERE / "results/native.json")
    for row in native["rows"]:
        assert row["config"]["code_sha256"] == sha((HERE / "native.py").read_bytes())
        for option in row["alternatives"]:
            assert len(option["token_ids"]) == len(option["token_logprobs"]) > 1
            assert math.isclose(sum(option["token_logprobs"]), option["sum_logp"], abs_tol=1e-8)
            assert option["target_text"] == json.dumps(option["object_id"]) + ","
        assert row["predicted"] == max(row["alternatives"], key=lambda x: x["sum_logp"])["object_id"]
        assert row["config"]["joint_tokenization"]
        assert '"object_id":' in row["config"]["native_prefix"]
    reports = [read_json(p) for p in (HERE / "results").glob("generation-summary-*.json")]
    report = max(reports, key=lambda x: len(x["cases"]))
    snapshot = HERE / report["snapshot"]
    assert sha(snapshot.read_bytes()) == report["snapshot_sha256"]
    replies = [json.loads(line) for line in snapshot.read_text().splitlines()]
    chains = {c.chain_id: c for c in load_dev()}
    # Recompute the final source scores from frozen replies, not the live cache.
    scored = [score_output(cases[r["id"]], r, registry(cases[r["id"]], chains)) for r in replies]
    old_scores = {(r["condition"], r["id"]): r for r in report["cases"]}
    for row in scored:
        for key in ("found", "expected", "wrong_writes", "invalid", "ungrounded", "success", "parsed_cleanly"):
            assert row[key] == old_scores[(row["condition"], row["id"])][key], (row["id"], key)
    base = {r["id"]: r for r in scored if r["condition"] == "base"}
    comparisons = {}
    for condition in sorted({r["condition"] for r in scored}):
        comparisons[condition] = {}
        for split in ("derive", "check", "all"):
            rows = [r for r in scored if r["condition"] == condition and (split == "all" or r["split"] == split)]
            matching_base = [base[r["id"]] for r in rows]
            comparisons[condition][split] = {"result": aggregate(rows), "matched_baseline": aggregate(matching_base),
                "lost_source_binding_cases": [r["id"] for r in rows if r["found"] < base[r["id"]]["found"]]}
    proof = read_json(HERE / "results/duplicate-fixture-proof.json")
    a, b = cases[proof["duplicate_fixture"]], cases[proof["covered_by"]]
    assert shadow_prompt(a["prompt"]) == shadow_prompt(b["prompt"])
    assert a["system"] == b["system"] and a["expected"] == b["expected"]

    full = read_json(HERE / "results/full-window-summary.json")
    full_rows = read_json(HERE / "results/full-window-outputs.json")["rows"]
    full_frozen = read_json(HERE / "data/full-window-freeze.json")
    assert {r["original_key"] for r in full_rows} == {w["key"] for w in full_frozen["windows"]}
    source_meetings = {m.meeting.meeting_id: m.meeting for chain in chains.values() for m in chain.meetings}
    verified_focus = []
    for item in full["source_focus"]:
        grounded = True
        if item["should_write"]:
            text = source_meetings[item["meeting"]].turns[item["turn"]].text.casefold()
            grounded = bool(item["quotes"]) and all(q.casefold() in text and item["value"].casefold() in q.casefold() for q in item["quotes"])
        assert item["passed"] and grounded, item
        verified_focus.append({**item, "positive_quote_grounded_and_names_value": grounded})

    # Source judgments are AI-assisted and kept separate from unchanged gold.
    reasons = {
        (76, "speech"): "The exchange asks whether speech recognition also requires an advanced chip; lack of information is not a decision to exclude speech.",
        (86, "colour"): "The source discusses coloured buttons, tentatively, followed by rejection; it does not decide the remote's overall colour.",
        (125, "speech"): "The negation concerns placing speech controls on top / access through opening the device, not excluding speech recognition.",
        (164, "lcd"): "The surrounding source concerns a transparent/replaceable front and materials, not a decision to include an LCD.",
    }
    new_writes = read_json(HERE / "results/full-window-new-write-audit.json")
    assert {(r["turn"], r["object_id"]) for r in new_writes} == set(reasons)
    audited = [{**r, "source_supported": False, "source_assessment": reasons[(r["turn"], r["object_id"])],
                "assessor": "AI-assisted source audit, not independently human-adjudicated gold",
                "caveat": "Newly produced/anchored relative to baseline; some replace earlier unsupported writes, so this is not a count of net additional errors."} for r in new_writes]
    write_json(HERE / "results/source-audit-final.json", {"focus": verified_focus, "new_or_reanchored_real_writes": audited,
        "source_valid_fixture_gains": {"p0-0-buttons": "Enter-button shape correctly routes to an untracked shadow, not case curve.",
            "p1-0-buttons": "Button rubber correctly routes to an untracked shadow while lithium battery and case curve remain.",
            "p5-0-buttons": "The unchanged 'It's plastic' answer is resolved from the preceding button-material question.",
            "p4-0-case": "Additional LCD inclusion cites the explicit 'we've incorporated the L_C_D_ screen ... as part of the design' clause."},
        "not_a_binding_gain": {"n1": "Bare [] becomes {events:[]}; format improvement only."}})

    supplied = read_json(HERE / "results/contracts.json")
    material = read_json(HERE / "results/contracts-shadow.json")
    contract_rows = supplied["rows"] + material["rows"]
    assert len(contract_rows) == 14 and all(r["passed"] for r in contract_rows)
    contract_replies = [record for row in contract_rows for record in row["records"]]
    all_generations = replies + contract_replies + full_rows
    cuts = [r["id"] for r in all_generations if r["cut_repeat"]]
    budgets = [r["id"] for r in all_generations if r["hit_budget"]]
    assert not cuts and not budgets
    native_peaks = [option["peak_mlx_gb"] for row in native["rows"] for option in row["alternatives"]]
    peak_mlx = max(native_peaks + [r["peak_gb"] for r in all_generations])
    peak_rss = max(native["peak_process_rss_gb"], supplied["peak_process_rss_gb"], material["peak_process_rss_gb"],
                   read_json(HERE / "results/full-window-outputs.json")["peak_process_rss_gb"])
    leases = []
    for path in HERE.glob("*.log"):
        for line in path.read_text().splitlines():
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(record, dict) and record.get("closed"):
                peak_rss = max(peak_rss, record.get("peak_process_rss_gb", 0))
                leases.append({"log": path.name, **record})
    prompts = {p["key"]: p for p in read_json(R1 / "data/prompts.json")["app"]}
    original_rows = [prompts[r["original_key"]]["baseline"] for r in full_rows]
    phase1_generation = subprocess.check_output(["git", "show", "04a1b5df5:research/weight-edit-attribution/round2/generation.py"], cwd=HERE.parents[2])
    assert sha(phase1_generation) == read_json(HERE / "data/procedure-freeze.json")["code_sha256"]["generation.py"]
    assert sha((HERE / "generation.py").read_bytes()) == read_json(HERE / "data/shadow-freeze.json")["source_code_sha256"]
    verdict = {"status": "NO QUALIFYING DEVELOPMENT / VALIDATION CANDIDATE",
        "reason": "The shadow procedure has narrow source-valid improvements, but the four-window transfer improves only change-count QA, leaves current QA 28/43, and produces/reanchors unsupported off-target writes. Stop this bounded path; no promotion or further tuning on checks.",
        "baseline": {"source_revision": "225f709fd27779103ea6dc01058776528a74af4b", "first_round_commit": "cc51a9a5e",
            "model": "mlx-community/Qwen3.5-4B-MLX-4bit", "revision": "32f3e8ecf65426fc3306969496342d504bfa13f3",
            "decode": "thinking off, greedy, 1800 extraction tokens, historical app system/repairs",
            "current_main": "Not evaluated. Parent reports newer amounts/singleton/HUD fixes and integration commits; they are not silently included in this historical baseline."},
        "case_identity": {"sha256": freeze["case_sha256"], "controlled": 24, "natural": 6,
            "derive": "ES2003b/c and TS3004c/d: 16 controlled + 3 natural fixtures", "check": "IS1008b/d and TS3006d: 8 controlled + 3 natural fixtures",
            "unique_shadow_requests": 29, "duplicate_proof": "results/duplicate-fixture-proof.json",
            "labels": "AI-assisted source judgments, not independent human gold"},
        "native": {"scope": "conditional full-target sequence likelihood rankings after a teacher-forced native quoted-event prefix, not free-generation accuracy",
            "derivation_correct": "12/16", "check_correct": "6/8", "dual_registered": {"derive": "8/8", "check": "4/4"},
            "single_registered_case": {"derive": "4/4", "check": "2/2"}, "untracked_should_be_null": {"derive": "0/4", "check": "0/2"},
            "localization": native["localization"], "weights_modified": False, "neural_gate": "Closed: 0 errors on old dual-tracked binding rankings; no weight or activation intervention was justified."},
        "source_generation": comparisons,
        "full_window": {"scope": "4 original OLD-DEV windows regenerated; other 93 windows replayed unchanged; original prompt beliefs fixed (open loop), not a 97-window closed-loop run",
            "baseline": {k: full["baseline"][k] for k in ("qa_exact", "qa_exact_by_type", "tp", "values", "inbox_confirm_all", "unclean")},
            "shadow": {k: full["shadow"][k] for k in ("qa_exact", "qa_exact_by_type", "tp", "values", "inbox_confirm_all", "unclean")},
            "source_focus_passed": "6/6 (two misbindings removed, four source-supported controls kept)",
            "off_target_audit": "results/source-audit-final.json", "question_flips": full["question_flips"],
            "generation_seconds": sum(r["seconds"] for r in full_rows), "historical_baseline_seconds_same_windows": sum(r["seconds"] for r in original_rows),
            "new_call_tokens": sum(r["output_tokens"] for r in full_rows), "baseline_tokens_same_windows": sum(r["output_tokens"] for r in original_rows)},
        "contracts": {"supplied_base_and_subject_first": "6/6", "active_material_domain_base_and_shadow": "8/8",
            "rows": [{k: r[k] for k in ("condition", "fixture", "passed", "actual")} for r in contract_rows]},
        "cost": {"extra_product_model_calls_per_extraction": 0, "native_target_continuations_scored": 72,
            "fixture_generations": len(replies), "contract_generations": len(contract_replies), "full_window_generations": len(full_rows),
            "peak_mlx_gb": peak_mlx, "peak_process_rss_gb": peak_rss, "memory_note": "Different memory accounting, not additive; MLX allocator cache capped at 256 MiB.",
            "leases": leases, "timing_note": "Recorded wall times exclude model-load/queue wait; historical cached timings are not synchronized speed benchmarks."},
        "repeat_stop": {"configured_in_research_driver": True, "actual_cut_count": len(cuts), "hit_budget_count": len(budgets),
            "interpretation": "Zero invocations in every round-2 generated reply. No result or proposed product change depends on naive repeat stopping; it remains rejected."},
        "integrity": {"round1_hashes_preserved": hashes, "frozen_case_hash_matches": True, "complete_sequence_sums_verified": 72,
            "source_score_replay_matches": True, "chronology_checks_passed": 14, "positive_full_window_quotes_checked": 4,
            "exact_dev_only_loader": "r2_common imports round1 common.load_dev: explicitly named .chain/.ask files, no held-out directory scan",
            "final_validation_generation_or_scoring": False, "protected_engine_or_weights_modified": False},
        "rejections": ["Round1 layer-8 adapter", "Candidate A majority-value rule", "naive repeat stopping", "subject-first fields (recall loss)", "generic untracked sentinel (no improvement)", "shadow procedure for promotion (current-value/source-support gate not met)"]}
    write_json(HERE / "results/final-handoff.json", verdict)
    write_json(HERE / "results/final-verification.json", verdict["integrity"] | {"repeat_cuts": 0, "new_budget_hits": 0,
        "phase1_code_hash_matches_commit_04a1b5df5": True, "shadow_code_hash_matches_frozen_recipe": True,
        "new_model_calls_for_recovery": 0, "all_round2_python_syntax_valid": True})
    print(json.dumps({"status": verdict["status"], "native": verdict["native"], "cost": verdict["cost"], "integrity": verdict["integrity"]}, indent=2))


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "check":
        def canonical(value):
            if isinstance(value, dict):
                return {k: canonical(sorted(v, key=lambda x: x["log"]) if k == "leases" else v) for k, v in value.items()}
            if isinstance(value, list):
                return [canonical(v) for v in value]
            return value

        def compare_existing(path, value):
            assert canonical(read_json(path)) == canonical(value), path

        write_json = compare_existing
        main()
        print("READ-ONLY FINAL AUDIT REPLAY IDENTICAL")
    elif len(sys.argv) > 1 and sys.argv[1] == "hash":
        files = [p for p in HERE.rglob("*") if p.is_file() and p.name != "artifact-hashes.json"]
        write_json(HERE / "artifact-hashes.json", {str(p.relative_to(HERE)): sha(p.read_bytes()) for p in sorted(files)})
    else:
        main()
