"""How many suggestions would a reviewer have to decide? Replays the oracle-review run from its cache (no model) and counts the dispositions.

    python3.11 scripts/ami/review_burden.py --split test --cache results/cache/ami_test_memoria_review.jsonl --out results/ami/review_burden_test.json
"""
import argparse
import collections
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ENGINE))

import run_ami_review  # noqa: E402,F401  (patches the reviewer and the policy)
import run_ami  # noqa: E402
import replay_offline  # noqa: E402
from memoria_engine.evaluation.dataset import load_chains  # noqa: E402
from memoria_engine.windowed import WindowedExtractor  # noqa: E402
from specs import SPECS  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="test")
    ap.add_argument("--cache", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    chains = [c for c in load_chains(str(ENGINE / "data/ami_v0")) if SPECS[c.chain_id]["split"] == args.split]
    llm = replay_offline.CacheOnly(str(ENGINE / args.cache))
    status, review, per_meeting = collections.Counter(), collections.Counter(), []
    for chain in chains:
        run = run_ami.run_pipeline(chain, WindowedExtractor(llm), "immediate")
        for gm, res in zip(chain.meetings, run["results"]):
            c = collections.Counter(d.status for d in res.dispositions)
            r = collections.Counter(d.review for d in res.dispositions if d.status == "proposed")
            status.update(c)
            review.update(r)
            per_meeting.append({"chain": chain.chain_id, "meeting": gm.meeting.meeting_id, "statuses": dict(c), "reviewed": dict(r)})
    n = len(per_meeting)
    proposed = status.get("proposed", 0)
    out = {"split": args.split, "meetings": n, "dispositions": dict(status), "proposals_total": proposed, "proposals_per_meeting_mean": round(proposed / n, 2),
           "proposals_per_meeting_max": max(m["statuses"].get("proposed", 0) for m in per_meeting), "oracle_reviewer_outcomes": dict(review), "per_meeting": per_meeting}
    (ENGINE / args.out).write_text(json.dumps(out, indent=1))
    print(json.dumps({k: v for k, v in out.items() if k != "per_meeting"}, indent=1))


if __name__ == "__main__":
    main()
