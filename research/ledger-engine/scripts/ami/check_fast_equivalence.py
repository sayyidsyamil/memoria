"""Check that the prefix-reuse path gives the same outputs as the plain path, using calls the plain path already cached.

    python3.11 scripts/ami/check_fast_equivalence.py --reference results/cache/ami_dev_baselines.jsonl --n 4
"""
import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parents[1]
sys.path.insert(0, str(ENGINE))
sys.path.insert(0, str(HERE))

from memoria_engine.evaluation import baselines  # noqa: E402
from memoria_engine.evaluation.dataset import load_chains  # noqa: E402
from memoria_engine.evaluation.run_scaling import BASELINE_CONFIGS  # noqa: E402
from fastllm import FastCachingMLX  # noqa: E402
from specs import SPECS  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reference", required=True)
    ap.add_argument("--n", type=int, default=4)
    ap.add_argument("--config", default="fc+cot")
    args = ap.parse_args()
    reference = {}
    for line in (ENGINE / args.reference).read_text().splitlines():
        if line.strip():
            r = json.loads(line)
            reference[r["key"]] = r
    chains = [c for c in load_chains(str(ENGINE / "data/ami_v0")) if SPECS[c.chain_id]["split"] == "dev"]
    with tempfile.TemporaryDirectory() as tmp:
        llm = FastCachingMLX(str(Path(tmp) / "fast.jsonl"))
        llm.load()
        system = BASELINE_CONFIGS[args.config](llm)
        done, same, parse_same = 0, 0, 0
        rows = []
        for chain in chains:
            for q in chain.questions:
                prompt = system.prompt(chain, q)
                budget = baselines.COT_TOKENS if system.cot else 24
                ref = reference.get(llm._key(prompt, budget))
                if ref is None:
                    continue
                t = time.perf_counter()
                out = llm.complete(prompt, budget)
                took = time.perf_counter() - t
                a = baselines.score_item(chain, q, ref["text"], cot=system.cot)
                b = baselines.score_item(chain, q, out["text"], cot=system.cot)
                done += 1
                same += out["text"] == ref["text"]
                parse_same += a.get("correct") == b.get("correct")
                rows.append({"qid": f"{chain.chain_id}.{q.qid}", "identical_text": out["text"] == ref["text"], "same_verdict": a.get("correct") == b.get("correct"),
                             "plain_seconds": round(ref["seconds"], 1), "fast_seconds": round(took, 1), "output_tokens": out["output_tokens"]})
                print(rows[-1], flush=True)
                if done >= args.n:
                    break
            if done >= args.n:
                break
        print(json.dumps({"compared": done, "identical_text": same, "same_verdict": parse_same, "prefix_builds": llm.prefix_builds, "prefix_hits": llm.prefix_hits}))


if __name__ == "__main__":
    main()
