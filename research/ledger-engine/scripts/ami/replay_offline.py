"""Replay a finished AMI run from its call cache WITHOUT loading any model, and compare it with the stored result.

Used after the engine fixes (results/testing/defect_log.md) to show that the patched code reproduces the frozen evaluation.
A prompt that is not in the cache stops the replay (the code would then have asked the model something new).

    python3.11 scripts/ami/replay_offline.py --split test --part memoria --cache results/cache/ami_test_memoria.jsonl \
        --stored results/ami/memoria_test.json --out /tmp/replay_memoria_test.json
    python3.11 scripts/ami/replay_offline.py --split test --part baselines --configs fc+cot,bm25-12 --cache results/cache/ami_test_baselines.jsonl \
        --stored results/ami/baselines_test.json --out /tmp/replay_baselines_test.json
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ENGINE))

import memoria_engine.llmcache as llmcache  # noqa: E402


class CacheOnly(llmcache.CachingMLX):
    def load(self):
        return None

    def complete(self, prompt, max_tokens=None):
        budget = max_tokens or self.max_tokens
        hit = self._cache.get(self._key(prompt, budget))
        if hit is None:
            raise SystemExit("cache miss: this prompt was not recorded, so the replay is not identical to the original run")
        self.hits += 1
        return {"text": hit["text"], "seconds": hit["seconds"], "prompt_tokens": hit["prompt_tokens"], "output_tokens": hit["output_tokens"], "cached": True}


def comparable(report):
    """The parts of a result that must be identical (not wall-clock fields)."""
    out = {}
    if "memoria" in report:
        m = report["memoria"]
        out["qa"], out["extraction"], out["ledger"] = m["qa"], m["extraction"], m["ledger"]
        out["router_exact"] = m["router"]["exact"]
        out["rows"] = [(r["chain"], r["qid"], r["route_exact"], {c: a["answer"] for c, a in r["answers"].items()}) for r in m["rows"]]
    if "baselines" in report:
        out["baselines"] = {name: {"qa": b["qa"], "items": [(i["chain"], i["qid"], i.get("correct"), i.get("prediction", i.get("answer"))) for i in b["items"]]} for name, b in report["baselines"].items()}
    return out


if __name__ == "__main__":
    args = sys.argv[1:]
    stored = Path(ENGINE / args[args.index("--stored") + 1])
    cleaned = [a for i, a in enumerate(args) if a != "--stored" and (i == 0 or args[i - 1] != "--stored")]
    sys.argv = [sys.argv[0]] + cleaned
    llmcache.CachingMLX = CacheOnly
    if "--review" in sys.argv:
        sys.argv.remove("--review")
        import run_ami_review  # noqa: F401  (replays the oracle-reviewer run)
    import run_ami

    run_ami.main()
    out = Path(sys.argv[sys.argv.index("--out") + 1])
    out = out if out.is_absolute() else ENGINE / out
    a, b = comparable(json.loads(stored.read_text())), comparable(json.loads(out.read_text()))
    if a == b:
        print("REPLAY IDENTICAL: question answers, scores, extraction and ledger match the stored run")
    else:
        keys = [k for k in a if a[k] != b.get(k)]
        print("REPLAY DIFFERS in:", keys)
        sys.exit(1)
