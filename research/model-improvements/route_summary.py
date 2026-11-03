"""Routing per model variant on development questions, from the cache (no model).

    python3.11 route_summary.py <variant> [<variant> ...]

The app's router request (October prompt r1 through the worker: its system message, 1,800 tokens, greedy), parsed as
the app parses it (`ask_facts._complete_attribute`, then `parse_route`). Exact = same type, slot and dates as the
structured question; right on gold facts = the routed lookup answers correctly on the gold ledger (router only).
"""
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
import harness  # noqa: E402
from lm import APP_SYSTEM, LM  # noqa: E402

HERE = Path(__file__).resolve().parent


def summary(variant, splits="old-dev,new-dev"):
    from ask_facts import _complete_attribute
    from memoria_engine.evaluation import baselines
    from memoria_engine.evaluation.oracle import values_equal
    from memoria_engine.evaluation.router import build_prompt, parse_route, route_matches, routed_answer
    lm = LM(variant, HERE / "cache" / f"{variant}.jsonl", offline=True)
    n = exact = failed = right = budget = 0
    seconds = []
    for chain in harness.load_series(harness.series_of(splits)):
        gold = harness.gold_pipeline(chain)
        today = baselines.today_iso(chain)
        for q in chain.questions:
            record = lm.app_generate(build_prompt(chain.registry, today, q.ask), 1800, APP_SYSTEM)
            route = parse_route(_complete_attribute(record["text"], chain.registry, q.ask), chain.registry)
            n += 1
            exact += route_matches(route, q)
            failed += not route.ok
            right += values_equal(routed_answer(gold.ledger, route, chain.now), q.gold)
            budget += record["hit_budget"]
            seconds.append(record["seconds"])
    seconds.sort()
    return {"variant": variant, "questions": n, "exact": exact, "failed_parse": failed, "right_on_gold_facts": right,
            "hit_budget": budget, "seconds_p50_p95": [round(seconds[len(seconds) // 2], 2), round(seconds[int(0.95 * len(seconds))], 2)]}


if __name__ == "__main__":
    for v in sys.argv[1:]:
        print(json.dumps(summary(v)))
