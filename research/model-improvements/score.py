"""Score extraction runs from the call cache, with no model (a cache miss stops the run).

    python3.11 score.py <variant> <mechanism> <split[,split]> [--routes] [--out results/x.json]

Prints and writes: extraction TP/FP/FN, precision, recall, F1 with bootstrap intervals over meetings; QA with exact
routes (the extractor alone) and, with --routes, with the model router; writes against the gold value in force;
belief-changing proposals per meeting under confirm_all with the window oracle reviewer (open loop) and QA after it;
mechanical failures per window (not parsed cleanly, budget hit, repeated events); seconds per window and per meeting.
"""
import json
import statistics
import sys
from pathlib import Path

sys.dont_write_bytecode = True
import harness  # noqa: E402
from lm import APP_SYSTEM, LM  # noqa: E402
from memoria_engine.evaluation import metrics  # noqa: E402

HERE = Path(__file__).resolve().parent


def routes_for(chain, lm):
    from ask_facts import _complete_attribute
    from memoria_engine.evaluation import baselines
    from memoria_engine.evaluation.router import build_prompt, parse_route
    today = baselines.today_iso(chain)
    out, exact, failed = {}, 0, 0
    from memoria_engine.evaluation.router import route_matches
    for q in chain.questions:
        reply = lm.app_generate(build_prompt(chain.registry, today, q.ask), 1800, APP_SYSTEM)["text"]
        route = parse_route(_complete_attribute(reply, chain.registry, q.ask), chain.registry)
        out[q.qid] = route
        exact += route_matches(route, q)
        failed += not route.ok
    return out, exact, failed


def percentile(values, p):
    values = sorted(values)
    if not values:
        return None
    k = (len(values) - 1) * p / 100
    lo, hi = int(k), min(int(k) + 1, len(values) - 1)
    return round(values[lo] + (values[hi] - values[lo]) * (k - lo), 2)


def summarise(scores, route_stats=None):
    meetings = [m for s in scores for m in s["meetings"]]
    agg = metrics.aggregate_extraction(meetings, 0)
    calls = [c for s in scores for c in s["calls"]]
    per_meeting = {}
    for c in calls:
        per_meeting[c["meeting"]] = per_meeting.get(c["meeting"], 0) + c["seconds"]
    values = {}
    for s in scores:
        for k, v in s["values"].items():
            values[k] = values.get(k, 0) + v
    n_meetings = len(meetings)
    inbox = {k: sum(s["inbox"][k] for s in scores) for k in ("proposals", "accepted", "edited", "rejected")}
    qa_exact = [x for s in scores for x in s["qa_exact"]]
    after = [x for s in scores for x in s["inbox"]["qa_after_review"]]
    types = [t for s in scores for t in s["types"]]
    by_type = {t: f"{sum(x for x, y in zip(qa_exact, types) if y == t)}/{types.count(t)}" for t in sorted(set(types))}
    out = {
        "series": [s["series"] for s in scores], "meetings": n_meetings, "gold_events": agg["gold_events"],
        "tp": agg["tp"], "fp": agg["fp"], "fn": agg["fn"],
        "precision": round(agg["precision"], 3) if agg["precision"] is not None else None,
        "recall": round(agg["recall"], 3), "f1": round(agg["f1"], 3) if agg["f1"] is not None else None, "ci_95": agg["ci_95"],
        "miss_reasons": agg["miss_reasons"], "fp_reasons": agg["fp_reasons"], "filtered": agg["filtered"],
        "writes_per_meeting": round(sum(m["reach"] for m in meetings) / n_meetings, 2),
        "values": values,
        "qa_exact": f"{sum(qa_exact)}/{len(qa_exact)}", "qa_exact_by_type": by_type,
        "inbox_confirm_all": {**inbox, "per_meeting": round(inbox["proposals"] / n_meetings, 2),
                              "qa_after_review": f"{sum(after)}/{len(after)}"},
        "windows": len(calls), "unclean": sum(not c["parsed_cleanly"] for c in calls),
        "hit_budget": sum(c["hit_budget"] for c in calls), "windows_with_repeats": sum(c["duplicates"] > 0 for c in calls),
        "window_seconds_p50_p95": [percentile([c["seconds"] for c in calls], 50), percentile([c["seconds"] for c in calls], 95)],
        "meeting_seconds_p50_p95": [percentile(list(per_meeting.values()), 50), percentile(list(per_meeting.values()), 95)],
        "meeting_seconds_mean": round(statistics.mean(per_meeting.values()), 1) if per_meeting else None,
        "output_tokens_per_meeting": round(sum(c["output_tokens"] for c in calls) / n_meetings, 1),
        "peak_gb_max": max((c["peak_gb"] or 0) for c in calls) if calls else None,
        "per_series": {s["series"]: {"tp": sum(len(m["tp"]) for m in s["meetings"]), "fp": sum(len(m["fp"]) for m in s["meetings"]),
                                     "fn": sum(len(m["miss"]) for m in s["meetings"]), "qa_exact": f"{sum(s['qa_exact'])}/{len(s['qa_exact'])}",
                                     "wrong": s["values"].get("wrong", 0), "proposals": s["inbox"]["proposals"]} for s in scores},
    }
    if route_stats:
        qa_routed = [x for s in scores for x in (s["qa_routed"] or [])]
        out["router"] = {**route_stats, "qa_routed": f"{sum(qa_routed)}/{len(qa_routed)}"}
    return out


def score(variant, mechanism, splits, with_routes=False, allow_validation=False):
    lm = LM(variant, HERE / "cache" / f"{variant}.jsonl", offline=True)
    chains = harness.load_series(harness.series_of(splits), allow_validation=allow_validation)
    scores, exact, failed, n = [], 0, 0, 0
    for chain in chains:
        routes = None
        if with_routes:
            routes, e, f = routes_for(chain, lm)
            exact, failed, n = exact + e, failed + f, n + len(chain.questions)
        scores.append(harness.score_chain(chain, harness.run_chain(chain, lm, mechanism), routes))
    return summarise(scores, {"exact": exact, "failed": failed, "n": n} if with_routes else None), scores


if __name__ == "__main__":
    args = sys.argv[1:]
    out_path = None
    if "--out" in args:
        at = args.index("--out")
        out_path = HERE / args[at + 1]
        del args[at:at + 2]
    with_routes = "--routes" in args
    args = [a for a in args if a != "--routes"]
    summary, scores = score(args[0], args[1], args[2], with_routes)
    summary = {"variant": args[0], "mechanism": args[1], "splits": args[2], **summary}
    print(json.dumps(summary, indent=1))
    if out_path:
        if out_path.exists():
            raise SystemExit(f"{out_path} exists; results are never overwritten")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        detail = [{k: v for k, v in s.items() if k != "meetings"} | {"meetings": s["meetings"]} for s in scores]
        out_path.write_text(json.dumps({"summary": summary, "series": detail}, indent=1, default=str))
