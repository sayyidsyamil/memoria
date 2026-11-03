"""Checks of this harness that need no model.

    python3.11 check_harness.py october     # October's replies through harness.py reproduce October's dev and test numbers
"""
import hashlib
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
import harness  # noqa: E402

OCTOBER = harness.LEDGER / "results"


class OctoberReplies:
    """lm.LM's interface over October's call cache (key: model id, budget, prompt; the prompt alone, no system message)."""

    def __init__(self, path):
        self.cache = {}
        for line in Path(path).read_text().splitlines():
            if line.strip():
                record = json.loads(line)
                self.cache[record["key"]] = record

    def app_generate(self, prompt, max_tokens, system, tag=None):
        assert system == "" and max_tokens == 900
        key = hashlib.sha256(f"mlx-community/Qwen3.5-4B-MLX-4bit\n{max_tokens}\n{prompt}".encode()).hexdigest()
        record = self.cache[key]
        return {**record, "hit_budget": record["output_tokens"] >= max_tokens}


def october():
    same = True
    for split, cache, stored in (("old-dev", "ami_dev_memoria.jsonl", "memoria_dev.json"),
                                 ("old-test", "ami_test_memoria.jsonl", "memoria_test.json")):
        lm = OctoberReplies(OCTOBER / "cache" / cache)
        report = json.loads((OCTOBER / "ami" / stored).read_text())["memoria"]
        scores = [harness.score_chain(c, harness.run_chain(c, lm, "october")) for c in harness.load_series(harness.series_of(split))]
        tp = sum(len(m["tp"]) for s in scores for m in s["meetings"])
        fp = sum(len(m["fp"]) for s in scores for m in s["meetings"])
        fn = sum(len(m["miss"]) for s in scores for m in s["meetings"])
        qa = sum(sum(s["qa_exact"]) for s in scores)
        n = sum(len(s["qa_exact"]) for s in scores)
        want = report["extraction"]
        october_qa = report["qa"]["ext+oracle_route"]["overall"]
        ok = (tp, fp, fn, qa) == (want["tp"], want["fp"], want["fn"], october_qa["correct"])
        same &= ok
        print(f"{split}: harness TP {tp} FP {fp} FN {fn}, QA exact routes {qa}/{n} | October TP {want['tp']} FP {want['fp']} "
              f"FN {want['fn']}, QA {october_qa['correct']}/{october_qa['n']} -> {'same' if ok else 'DIFFERENT'}")
    print("HARNESS REPRODUCES OCTOBER" if same else "HARNESS DIFFERS FROM OCTOBER")
    return same


if __name__ == "__main__":
    if sys.argv[1:] == ["october"]:
        raise SystemExit(0 if october() else 1)
    raise SystemExit(__doc__)
