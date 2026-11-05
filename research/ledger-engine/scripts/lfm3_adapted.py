"""Development-only LFM3 run with adequate reasoning budget; not a drop-in test."""
import hashlib
import json
import time
from pathlib import Path

from huggingface_hub import snapshot_download
from memoria_engine.extractors import parse_events
from memoria_engine.llmcache import CachingMLX
from scripts.lfm3_bakeoff import preflight, REPO, REVISION
from scripts.model_bakeoff import ROOT, load_ami_runner
from scripts.hybrid_experiment import save
from memoria_engine.evaluation.dataset import load_chains


class AdaptedLFM(CachingMLX):
    def complete(self, prompt, max_tokens=None):
        from mlx_lm import generate
        from mlx_lm.sample_utils import make_sampler, make_logits_processors
        import mlx.core as mx

        requested = max_tokens or self.max_tokens
        budget = 1536 if requested == 90 else 4096
        key = hashlib.sha256(f"lfm-adapted-v1/{self.model_id}/{budget}/{prompt}".encode()).hexdigest()
        if key in self._cache:
            self.hits += 1
            return self._cache[key]
        self.load()
        mx.random.seed(0)
        rendered = self._tok.apply_chat_template([{"role": "user", "content": prompt}],
                                                tokenize=False, add_generation_prompt=True, enable_thinking=True)
        start = time.perf_counter()
        raw = generate(self._model, self._tok, prompt=rendered, max_tokens=budget, verbose=False,
                       sampler=make_sampler(temp=0.1, top_k=50),
                       logits_processors=make_logits_processors(repetition_penalty=1.1))
        # A reasoning block that never closes is not an answer; never salvage its examples as facts.
        final = raw.rsplit("</think>", 1)[-1].strip() if "</think>" in raw else ""
        record = {"key": key, "text": final, "raw_with_reasoning": raw, "seconds": time.perf_counter() - start,
                  "prompt_tokens": len(self._tok.encode(rendered)), "output_tokens": len(self._tok.encode(raw)),
                  "max_tokens": budget, "reasoning_finished": "</think>" in raw, "cached": False}
        with self.cache_path.open("a", encoding="utf-8") as file:
            file.write(json.dumps(record) + "\n")
        self._cache[key] = record
        self.misses += 1
        return record


def main():
    runtime = preflight()
    checkpoint = snapshot_download(REPO, revision=REVISION, local_files_only=True)
    out = ROOT / "results/model_bakeoff/lfm3_adapted_dev"
    sources = [Path(__file__)] + sorted((ROOT / "memoria_engine").rglob("*.py"))
    plan = {"runtime": runtime, "model": REPO, "revision": REVISION, "split": "dev",
            "temperature": 0.1, "top_k": 50, "repetition_penalty": 1.1, "seed_per_call": 0,
            "thinking": True, "extract_budget": 4096, "router_budget": 1536,
            "note": "adaptation chosen after failed drop-in dev run; not equal-budget comparison",
            "code_hashes": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}}
    if (out / "plan.json").exists() and json.loads((out / "plan.json").read_text()) != plan:
        raise ValueError("plan changed")
    save(out / "plan.json", plan)
    llm = AdaptedLFM(str(out / "calls.jsonl"), model_id=checkpoint)
    chains = [c for c in load_chains(str(ROOT / "data/ami_v0")) if c.chain_id in ("ES2003", "TS3004")]
    started = time.perf_counter()
    result = load_ami_runner()(chains, llm, print)
    import mlx.core as mx
    save(out / "results.json", {"config": plan, "memoria": result, "wall_seconds": time.perf_counter() - started,
                                "mlx_peak_gb": mx.get_peak_memory() / 1e9})
    print(json.dumps({"qa": result["qa"]["ext+router"], "extraction": result["extraction"],
                      "router": result["router"], "cost": result["cost"]}, indent=2))


if __name__ == "__main__":
    main()
