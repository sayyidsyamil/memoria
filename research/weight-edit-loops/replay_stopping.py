"""Full-dev closed-loop cache replay after stopping; no timing claim, no new model."""
import argparse
import json

from context import ALLOWED, HERE, load_chain, write_new_json
import harness
from lm import LM
from score import summarise
from stop_rule import analyse


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--conservative", action="store_true")
    args = parser.parse_args()
    policy = {"min_repeats": 3, "unresolved_only": True} if args.conservative else {}
    class Stopped(LM):
        def app_generate(self, *args, **kwargs):
            record = super().app_generate(*args, **kwargs)
            detector = analyse(record["text"], **policy)
            return {**record, "text": detector.closed_text()}

    lm = Stopped("4b", HERE / "data" / "reference_cache.jsonl", offline=True)
    scores = []
    for name in ALLOWED:
        chain = load_chain(name)
        scores.append(harness.score_chain(chain, harness.run_chain(chain, lm, "app")))
    summary = summarise(scores)
    summary = {k: v for k, v in summary.items() if not any(s in k for s in ("seconds", "tokens", "peak"))}
    # hit_budget belongs to historical calls, not actual stopped generations.
    summary.pop("hit_budget", None)
    result = {"kind": "offline closed-loop development replay", "cache_hits": lm.hits,
              "cache_misses": lm.misses, "summary": summary,
              "timing": "not measured; see actual run_generation results", "policy": policy}
    filename = "stop_conservative_closed_replay.json" if args.conservative else "stop_closed_replay.json"
    write_new_json(HERE / "results" / filename, result)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
