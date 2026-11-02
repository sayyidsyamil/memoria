"""Re-time a fixed sample of the test-split baseline calls on an awake machine, and check that generation is reproducible.

The overnight baseline run was slowed by laptop sleep, so its recorded latencies are unreliable for the calls made after the sleep began.
This script regenerates every 5th question of each (system, K) cell from scratch with an empty cache, in the same order as the run, and records
(a) the wall-clock generation time and (b) whether the fresh text is identical to the text the run stored (greedy decoding should make it so).

    caffeinate -ims python3.11 scripts/retime_sample.py > logs/retime.log 2>&1
"""
from __future__ import annotations

import json
import os
import statistics as st
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

from memoria_engine.evaluation import baselines, padding  # noqa: E402
from memoria_engine.evaluation.dataset import load_chains  # noqa: E402
from memoria_engine.evaluation.run_eval import SPLITS  # noqa: E402
from memoria_engine.llmcache import CachingMLX  # noqa: E402

STRIDE = 5
CACHE = "/tmp/retime_cache.jsonl"


def main() -> None:
    run = json.load(open("results/test/baselines_test.json", encoding="utf-8"))
    chains = {c.chain_id: c for c in load_chains("data/pilot_v0") if c.chain_id in SPLITS["test"]}
    Path(CACHE).unlink(missing_ok=True)
    llm = CachingMLX(CACHE)
    llm.load()
    systems = {"full-context+cot": baselines.FullContext(llm, cot=True), "bm25-rag(k=12)": baselines.BM25RAG(llm, k=12)}
    cells, calls = {}, []
    for k in run["levels"]:
        padded = {cid: padding.pad_chain(c, int(k), 0) for cid, c in chains.items()}
        for name, system in systems.items():
            for item in run["levels"][k]["systems"][name]["items"][::STRIDE]:
                q = next(q for q in chains[item["chain"]].questions if q.qid == item["qid"])
                started = time.perf_counter()
                res = system.answer(padded[item["chain"]], q)
                calls.append({"k": int(k), "system": name, "chain": item["chain"], "qid": item["qid"], "identical_text": res["raw"] == item["raw"],
                              "seconds_awake": round(res["seconds"], 2), "seconds_recorded": item["seconds"], "output_tokens": res["output_tokens"],
                              "prompt_tokens": res["prompt_tokens"], "wall": round(time.perf_counter() - started, 2)})
                print(f"K={k} {name} {item['chain']}.{item['qid']}: {calls[-1]['seconds_awake']}s (recorded {item['seconds']}s) identical={calls[-1]['identical_text']}", flush=True)
            rows = [c for c in calls if c["k"] == int(k) and c["system"] == name]
            cells[f"{k}|{name}"] = {"n": len(rows), "median_seconds_awake": st.median(c["seconds_awake"] for c in rows),
                                    "median_seconds_recorded": st.median(c["seconds_recorded"] for c in rows),
                                    "identical": sum(c["identical_text"] for c in rows)}
    out = {"stride": STRIDE, "machine_note": "awake, lid open", "date": time.strftime("%Y-%m-%d %H:%M:%S"), "cells": cells, "calls": calls,
           "identical_total": sum(c["identical_text"] for c in calls), "n_total": len(calls)}
    Path("results/test/retime_awake.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(json.dumps({"identical": f"{out['identical_total']}/{out['n_total']}", "cells": cells}, indent=1))


if __name__ == "__main__":
    main()
