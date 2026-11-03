"""The one final validation on new-val (PROTOCOL.md): preregister, run once, score.

    python3.11 validate.py prereg CANDIDATE [CANDIDATE]   # writes results/validation/preregistration.json (refuses if it exists)
    lease.py val-<series> -- <python> validate.py run SERIES   # model: baseline and candidates, closed loop; cache/4b.val.jsonl
    python3.11 validate.py score                        # no model: primary, guardrails, per series -> results/validation/result.json

`run` and `score` refuse if any preregistered file has changed, and `score` refuses unless every series has run. The
validation's model calls go to their own cache file. Nothing about new-val is opened by any other script
(harness.load_series refuses it unless called from here).
"""
import hashlib
import json
import math
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True
import harness  # noqa: E402
import score as scoring  # noqa: E402
from lm import LM, VARIANTS  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT = HERE / "results" / "validation"
PREREG = OUT / "preregistration.json"
CACHE = HERE / "cache" / "4b.val.jsonl"
BASELINE = "app"
FILES = ["harness.py", "lm.py", "score.py", "support.py", "consolidate.py", "numwords.py", "validate.py", "lease.py",
         "data/splits.json", "data/manifest.json", "PROTOCOL.md"]
ENGINE = ["src-tauri/resources/memory/temporal_service.py", "src-tauri/resources/memory/model_server.py",
          "src-tauri/resources/memory/memoria_engine/extractors.py", "src-tauri/resources/memory/memoria_engine/windowed.py",
          "src-tauri/resources/memory/memoria_engine/pipeline.py", "src-tauri/resources/memory/memoria_engine/ledger.py",
          "src-tauri/resources/memory/memoria_engine/evaluation/metrics.py", "src-tauri/resources/memory/memoria_engine/evaluation/oracle.py"]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def hashes():
    out = {name: sha(HERE / name) for name in FILES}
    out.update({name: sha(harness.ROOT / name) for name in ENGINE})
    for series in harness.SPLITS["new-val"]["series"]:
        out[f"data/ami_new/{series}.chain"] = sha(HERE / "data" / "ami_new" / f"{series}.chain")
    return out


def check():
    prereg = json.loads(PREREG.read_text())
    changed = [k for k, v in hashes().items() if prereg["hashes"].get(k) != v]
    if changed:
        raise SystemExit(f"preregistered files changed: {changed}")
    return prereg


def prereg(candidates):
    if PREREG.exists():
        raise SystemExit("already preregistered")
    OUT.mkdir(parents=True, exist_ok=True)
    data = {"written": time.strftime("%Y-%m-%d %H:%M:%S %z"), "variant": "4b", "revision": VARIANTS["4b"]["revision"],
            "baseline": BASELINE, "candidates": candidates, "series": harness.SPLITS["new-val"]["series"],
            "primary": "QA with exact routes (extractor only), paired exact sign test against the baseline, two-sided, Holm over the candidates; win = adjusted p < 0.05 and more right",
            "guardrails": {"gold_found": "candidate >= baseline - max(2, 5% of gold events)",
                           "correct_proposals_confirm_all": "candidate >= baseline - 2",
                           "wrong_writes": "candidate <= baseline", "unclean_replies": "candidate <= baseline + 1"},
            "loop": "closed loop: every configuration runs its own pipeline (its own beliefs in later prompts), immediate policy",
            "hashes": hashes()}
    PREREG.write_text(json.dumps(data, indent=1) + "\n")
    print(json.dumps(data, indent=1))


def run(series):
    prereg = check()
    lm = LM("4b", CACHE)
    for mechanism in [prereg["baseline"], *prereg["candidates"]]:
        chain = harness.load_series([series], allow_validation=True)[0]
        started = time.time()
        result = harness.run_chain(chain, lm, mechanism)
        print(json.dumps({"series": series, "mechanism": mechanism, "seconds": round(time.time() - started, 1),
                          "windows": len(result["calls"]), "misses": lm.misses, "hits": lm.hits}), flush=True)
    (OUT / f"ran-{series}").write_text(time.strftime("%Y-%m-%d %H:%M:%S\n"))
    lm.close()


def sign_test(a, b):
    a_only = sum(1 for x, y in zip(a, b) if x and not y)
    b_only = sum(1 for x, y in zip(a, b) if y and not x)
    n = a_only + b_only
    tail = sum(math.comb(n, i) for i in range(min(a_only, b_only) + 1)) / 2 ** n if n else 1.0
    return {"candidate_only": a_only, "baseline_only": b_only, "p_two_sided": min(1.0, 2 * tail)}


def score():
    prereg = check()
    missing = [s for s in prereg["series"] if not (OUT / f"ran-{s}").exists()]
    if missing:
        raise SystemExit(f"not run yet: {missing}")
    lm = LM("4b", CACHE, offline=True)
    chains = harness.load_series(prereg["series"], allow_validation=True)
    out, flat = {}, {}
    for mechanism in [prereg["baseline"], *prereg["candidates"]]:
        scores = [harness.score_chain(chain, harness.run_chain(chain, lm, mechanism)) for chain in chains]
        out[mechanism] = scoring.summarise(scores)
        flat[mechanism] = [x for s in scores for x in s["qa_exact"]]
    base = out[prereg["baseline"]]
    tests = {m: sign_test(flat[m], flat[prereg["baseline"]]) for m in prereg["candidates"]}
    order = sorted(tests, key=lambda m: tests[m]["p_two_sided"])
    k, running = len(order), 0.0
    for i, m in enumerate(order):  # Holm step-down
        running = max(running, min(1.0, (k - i) * tests[m]["p_two_sided"]))
        tests[m]["p_holm"] = running
    verdicts = {}
    for m in prereg["candidates"]:
        c = out[m]
        guards = {"gold_found": c["tp"] >= base["tp"] - max(2, math.ceil(0.05 * base["gold_events"])),
                  "correct_proposals_confirm_all": c["inbox_confirm_all"]["accepted"] >= base["inbox_confirm_all"]["accepted"] - 2,
                  "wrong_writes": c["values"].get("wrong", 0) <= base["values"].get("wrong", 0),
                  "unclean_replies": c["unclean"] <= base["unclean"] + 1}
        primary = tests[m]["candidate_only"] > tests[m]["baseline_only"] and tests[m]["p_holm"] < 0.05
        verdicts[m] = {"primary_win": primary, "guardrails": guards, "validated": primary and all(guards.values())}
    result = {"scored": time.strftime("%Y-%m-%d %H:%M:%S %z"), "preregistration_sha256": sha(PREREG), "summaries": out,
              "tests": tests, "verdicts": verdicts}
    path = OUT / "result.json"
    if path.exists():
        raise SystemExit("result.json exists; the validation is scored once")
    path.write_text(json.dumps(result, indent=1, default=str) + "\n")
    print(json.dumps({"tests": tests, "verdicts": verdicts}, indent=1))


if __name__ == "__main__":
    command, rest = sys.argv[1], sys.argv[2:]
    if command == "prereg":
        prereg(rest)
    elif command == "run":
        run(rest[0])
    elif command == "score":
        score()
    else:
        raise SystemExit(__doc__)
