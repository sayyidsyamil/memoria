"""Run Memoria and the two baselines on the fictional demo series with the same code as the AMI evaluation.

    python3.11 scripts/demo/run_demo_eval.py --policy immediate --out results/demo/demo_eval_immediate.json
    python3.11 scripts/demo/run_demo_eval.py --policy review    --out results/demo/demo_eval_review.json --part memoria

policy review = belief-changing conflicts go to an oracle reviewer (upper bound), as in scripts/ami/run_ami_review.py.
One model process at a time. Every call is cached in results/cache/demo_eval_<policy>.jsonl.
"""
import argparse
import json
import platform
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parents[1]
sys.path.insert(0, str(ENGINE))
sys.path.insert(0, str(ENGINE / "scripts" / "ami"))

import run_ami  # noqa: E402
from memoria_engine.evaluation import baselines  # noqa: E402
from memoria_engine.evaluation.dataset import load_chains  # noqa: E402
from memoria_engine.extractors import PROMPT_HASH, PROMPT_VERSION  # noqa: E402
from memoria_engine.llmcache import CachingMLX  # noqa: E402
from memoria_engine.windowed import WindowedExtractor  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--policy", choices=("immediate", "review"), default="immediate")
    ap.add_argument("--part", choices=("both", "memoria", "baselines"), default="both")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    if args.policy == "review":
        import run_ami_review  # noqa: F401  (patches run_ami.run_pipeline and the reviewer on import)
    chains = load_chains(str(ENGINE / "data" / "demo"))
    llm = CachingMLX(str(ENGINE / "results" / "cache" / f"demo_eval_{args.policy}.jsonl"))
    llm.load()
    started = time.perf_counter()
    report = {"config": {"split": "demo", "policy": args.policy, "chains": [c.chain_id for c in chains], "questions": sum(len(c.questions) for c in chains),
                         "model": llm.model_id, "extractor_prompt": PROMPT_VERSION, "extractor_prompt_sha256_12": PROMPT_HASH, "router_prompt": run_ami.routing.ROUTER_VERSION,
                         "window_chars": WindowedExtractor(None).window_chars, "cot_max_tokens": baselines.COT_TOKENS, "machine": platform.platform(),
                         "date": time.strftime("%Y-%m-%d %H:%M:%S"), "note": "FICTIONAL series authored with AI help; a system check, not evidence about real meetings"}}
    if args.part in ("both", "memoria"):
        report["memoria"] = run_ami.run_memoria(chains, llm, print)
    if args.part in ("both", "baselines"):
        report["baselines"] = run_ami.run_baselines(chains, llm, ["fc+cot", "bm25-12"], print)
    report["wall_seconds"] = round(time.perf_counter() - started, 1)
    out = ENGINE / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=1, default=str), encoding="utf-8")
    print(f"done in {report['wall_seconds']} s -> {out}")


if __name__ == "__main__":
    main()
