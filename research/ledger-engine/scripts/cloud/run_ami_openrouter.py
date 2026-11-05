"""Run scripts/ami/run_ami.py with a cloud model instead of the local one (same prompts, same scoring).

    export OPENROUTER_API_KEY=...   # this shell only
    python3.11 scripts/cloud/run_ami_openrouter.py --split test --part baselines --cache results/cache/cloud_test_baselines.jsonl --out results/ami/cloud_baselines_test.json
    python3.11 scripts/cloud/run_ami_openrouter.py --estimate --split test      # prints the expected cost, calls nothing
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ENGINE / "scripts" / "ami"))
sys.path.insert(0, str(ENGINE))

import memoria_engine.llmcache as llmcache  # noqa: E402
from openrouter_llm import CachingOpenRouter  # noqa: E402

PRICE_IN, PRICE_OUT = 0.14e-6, 0.42e-6  # DeepInfra fp8 list price per token on OpenRouter, checked 13 Oct 2026


def estimate(split: str) -> None:
    from memoria_engine.evaluation import baselines
    from memoria_engine.evaluation.dataset import load_chains
    from memoria_engine.evaluation.run_scaling import BASELINE_CONFIGS
    from specs import SPECS

    chains = [c for c in load_chains(str(ENGINE / "data/ami_v0")) if SPECS[c.chain_id]["split"] == split]
    total_in = total_out = n = 0
    for name, out_guess in (("fc+cot", 600), ("bm25-12", 600)):
        system = BASELINE_CONFIGS[name](None)
        for chain in chains:
            for q in chain.questions:
                total_in += len(system.prompt(chain, q)) / 3.6
                total_out += out_guess
                n += 1
    meetings = sum(len(c.meetings) for c in chains)
    mem_in, mem_out = meetings * 3 * 3500 + sum(len(c.questions) for c in chains) * 900, meetings * 3 * 250 + sum(len(c.questions) for c in chains) * 60
    cost = (total_in + mem_in) * PRICE_IN + (total_out + mem_out) * PRICE_OUT
    print(f"{split}: {n} baseline calls, about {total_in / 1e6:.2f}M baseline input tokens, Memoria about {mem_in / 1e6:.2f}M in; expected cost about ${cost:.2f} (upper-ish guess)")


if __name__ == "__main__":
    if "--estimate" in sys.argv:
        estimate(sys.argv[sys.argv.index("--split") + 1])
        sys.exit(0)
    llmcache.CachingMLX = CachingOpenRouter
    import run_ami

    run_ami.main()
