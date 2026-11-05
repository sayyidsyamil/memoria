"""Offline replay of the recorded evaluation: every model call must be a cache hit (no model is loaded, mlx is never imported).

Run from the engine directory on each engine version (original, patched copy) and compare the two output files:

    python3.11 results/testing/evidence/replay_evaluation.py OUTPUT.json
"""
import json, sys, time
sys.path.insert(0, ".")
from memoria_engine.llmcache import CachingMLX
from memoria_engine.evaluation.dataset import load_chains
from memoria_engine.evaluation.run_eval import SPLITS
from memoria_engine.evaluation import run_scaling

class ReplayOnly(CachingMLX):
    def load(self):
        pass
    def complete(self, prompt, max_tokens=None):
        budget = max_tokens or self.max_tokens
        hit = self._cache.get(self._key(prompt, budget))
        if hit is None:
            self.misses += 1
            raise LookupError("cache miss (would have called the model)")
        self.hits += 1
        return {"text": hit["text"], "seconds": hit["seconds"], "prompt_tokens": hit["prompt_tokens"],
                "output_tokens": hit["output_tokens"], "cached": True}

def replay(split, cache, levels):
    assert "mlx" not in sys.modules
    chains = [c for c in load_chains("data/pilot_v0", "ask") if c.chain_id in SPLITS[split]]
    llm = ReplayOnly(cache)
    out = {}
    for k in levels:
        t = time.perf_counter()
        try:
            lv = run_scaling.memoria_level(chains, k, "mlx", llm, None, 0, log=lambda *a, **kw: None)
        except LookupError as e:
            out[str(k)] = {"error": str(e)}
            continue
        keep = {key: lv[key] for key in ("shape", "extraction_base", "extraction_filler", "ledger_base", "ledger_all", "cost")}
        keep["answers"] = [(r["chain"], r["qid"], r["answers"]["ext+oracle_route"], r["answers"]["oracle_ext+oracle_route"]) for r in lv["rows"]]
        keep["qa"] = {c: lv["qa"][c] for c in ("ext+oracle_route", "oracle_ext+oracle_route")}
        out[str(k)] = keep
        print(f"{split} K={k}: ok in {time.perf_counter()-t:.1f}s, hits={llm.hits} misses={llm.misses}", flush=True)
    assert "mlx" not in sys.modules and "mlx_lm" not in sys.modules
    return out

if __name__ == "__main__":
    dest = sys.argv[1]
    res = {"test": replay("test", "results/cache/test_memoria.jsonl", [0, 8, 24, 48]),
           "dev": replay("dev", "results/cache/dev_memoria.jsonl", [0, 8])}
    json.dump(res, open(dest, "w"), indent=1, sort_keys=True, default=str)
    print("written", dest)
