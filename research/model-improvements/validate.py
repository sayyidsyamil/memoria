"""The one final validation on new-val (PROTOCOL.md): preregister, run once, score. Not run as of 3 November 2026.

    python3.11 validate.py prereg --baseline app@f45bbe549 CANDIDATE [CANDIDATE]   # writes results/validation/preregistration.json
    lease.py val-<series> -- <python> validate.py run SERIES   # model: baseline and candidates, closed loop; cache/4b.val.jsonl
    python3.11 validate.py score                        # no model: primary, guardrails, per series -> results/validation/result.json

`run` and `score` refuse if any preregistered file has changed, and `score` refuses unless every series has run. The
validation's model calls go to their own cache file.

Data access: `harness.load_series` reads exactly the requested chain file and refuses new-val unless called from here;
the reserved new-val chain files are opened only by this script (hashed at preregistration, read by `run` and
`score`). Before 3 November 18:45 the loader parsed every chain file of a folder whenever one series was loaded, so the
reserved chains were parsed into memory during development, though never sent to a model or scored (PROTOCOL.md).

Baselines are named, frozen identities. The only one defined is "app@f45bbe549": the app path of f45bbe549, whose app
modules are pinned in pinned/f45bbe549 and are identical to the v0.3.1-uat release. A current-production baseline
(such as main) needs its own pinned files and an entry in BASELINES before it can be preregistered.
Candidate A (`app-nosys-numwords-loopstop+modevalue`) is rejected for default deployment; validating it could only test
an experimental one-value-per-meeting policy.
"""
import hashlib
import json
import math
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True
import harness  # noqa: E402
import pinned  # noqa: E402
import score as scoring  # noqa: E402
from lm import LM, VARIANTS  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT = HERE / "results" / "validation"
PREREG = OUT / "preregistration.json"
CACHE = HERE / "cache" / "4b.val.jsonl"
BASELINES = {"app@f45bbe549": {"mechanism": "app", "pinned": "pinned/f45bbe549/MANIFEST.json"}}
REJECTED = {"app-nosys-numwords-loopstop+modevalue": "candidate A: fails the product-contract fixtures (test_modevalue_contract.py)"}
FILES = ["harness.py", "lm.py", "score.py", "support.py", "consolidate.py", "numwords.py", "validate.py", "lease.py",
         "pinned.py", "pinned/f45bbe549/MANIFEST.json", "data/splits.json", "data/manifest.json", "PROTOCOL.md"]
ENGINE = ["src-tauri/resources/memory/memoria_engine/extractors.py", "src-tauri/resources/memory/memoria_engine/windowed.py",
          "src-tauri/resources/memory/memoria_engine/pipeline.py", "src-tauri/resources/memory/memoria_engine/ledger.py",
          "src-tauri/resources/memory/memoria_engine/evaluation/metrics.py", "src-tauri/resources/memory/memoria_engine/evaluation/oracle.py"]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def hashes(reserved=True):
    """Identity of everything a validation run depends on. reserved=False leaves out the new-val chain files (for checks
    made during development, which must not open them)."""
    out = {name: sha(HERE / name) for name in FILES}
    out.update({name: sha(harness.ROOT / name) for name in ENGINE})
    out.update({f"pinned/f45bbe549/{name}": info["sha256"] for name, info in pinned.verify()["pinned"].items()})
    if reserved:
        for series in harness.SPLITS["new-val"]["series"]:
            out[f"data/ami_new/{series}.chain"] = sha(HERE / "data" / "ami_new" / f"{series}.chain")
    return out


def check():
    prereg = json.loads(PREREG.read_text())
    changed = [k for k, v in hashes().items() if prereg["hashes"].get(k) != v]
    if changed:
        raise SystemExit(f"preregistered files changed: {changed}")
    return prereg


def prereg(candidates, baseline):
    if PREREG.exists():
        raise SystemExit("already preregistered")
    if baseline not in BASELINES:
        raise SystemExit(f"unknown baseline {baseline!r}; defined: {sorted(BASELINES)}. A current-production baseline needs "
                         "its own pinned files and an entry in BASELINES first.")
    for candidate in candidates:
        if candidate in REJECTED:
            print(f"warning: {candidate} is {REJECTED[candidate]}; it can only be validated as an experimental policy")
    OUT.mkdir(parents=True, exist_ok=True)
    data = {"written": time.strftime("%Y-%m-%d %H:%M:%S %z"), "variant": "4b", "revision": VARIANTS["4b"]["revision"],
            "baseline": baseline, "baseline_mechanism": BASELINES[baseline]["mechanism"], "candidates": candidates,
            "series": harness.SPLITS["new-val"]["series"],
            "primary": "QA with exact routes (extractor only), paired exact sign test against the baseline, two-sided, Holm over the candidates; win = adjusted p < 0.05 and more right",
            "guardrails": {"gold_found": "candidate >= baseline - max(2, 5% of gold events)",
                           "correct_proposals_confirm_all": "candidate >= baseline - 2",
                           "wrong_writes": "candidate <= baseline", "unclean_replies": "candidate <= baseline + 1",
                           "current_value_questions": "candidate >= baseline - 2"},
            "report_beside_primary": "empty-record floor, per-type scores, the needs-a-value subset, and a source audit of any gain in gold events or current values",
            "loop": "closed loop: every configuration runs its own pipeline (its own beliefs in later prompts), immediate policy",
            "hashes": hashes()}
    PREREG.write_text(json.dumps(data, indent=1) + "\n")
    print(json.dumps(data, indent=1))


def run(series):
    prereg = check()
    lm = LM("4b", CACHE)
    for mechanism in [prereg["baseline_mechanism"], *prereg["candidates"]]:
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
    for mechanism in [prereg["baseline_mechanism"], *prereg["candidates"]]:
        scores = [harness.score_chain(chain, harness.run_chain(chain, lm, mechanism)) for chain in chains]
        out[mechanism] = scoring.summarise(scores)
        flat[mechanism] = [x for s in scores for x in s["qa_exact"]]
    base = out[prereg["baseline_mechanism"]]
    tests = {m: sign_test(flat[m], flat[prereg["baseline_mechanism"]]) for m in prereg["candidates"]}
    order = sorted(tests, key=lambda m: tests[m]["p_two_sided"])
    k, running = len(order), 0.0
    for i, m in enumerate(order):  # Holm step-down
        running = max(running, min(1.0, (k - i) * tests[m]["p_two_sided"]))
        tests[m]["p_holm"] = running
    verdicts = {}
    for m in prereg["candidates"]:
        c = out[m]
        current = lambda summary: int(summary["qa_exact_by_type"]["current"].split("/")[0])
        guards = {"gold_found": c["tp"] >= base["tp"] - max(2, math.ceil(0.05 * base["gold_events"])),
                  "correct_proposals_confirm_all": c["inbox_confirm_all"]["accepted"] >= base["inbox_confirm_all"]["accepted"] - 2,
                  "wrong_writes": c["values"].get("wrong", 0) <= base["values"].get("wrong", 0),
                  "unclean_replies": c["unclean"] <= base["unclean"] + 1,
                  "current_value_questions": current(c) >= current(base) - 2}
        primary = tests[m]["candidate_only"] > tests[m]["baseline_only"] and tests[m]["p_holm"] < 0.05
        verdicts[m] = {"primary_win": primary, "guardrails": guards, "validated": primary and all(guards.values())}
    result = {"scored": time.strftime("%Y-%m-%d %H:%M:%S %z"), "preregistration_sha256": sha(PREREG), "summaries": out,
              "empty_ledger_right": sum(1 for chain in chains for q in chain.questions
                                        if q.gold is None or (q.type == "n_changes" and q.gold == 0)),
              "tests": tests, "verdicts": verdicts}
    path = OUT / "result.json"
    if path.exists():
        raise SystemExit("result.json exists; the validation is scored once")
    path.write_text(json.dumps(result, indent=1, default=str) + "\n")
    print(json.dumps({"tests": tests, "verdicts": verdicts}, indent=1))


if __name__ == "__main__":
    command, rest = sys.argv[1], sys.argv[2:]
    if command == "prereg":
        if "--baseline" not in rest:
            raise SystemExit("prereg needs --baseline NAME (a frozen identity in BASELINES)")
        at = rest.index("--baseline")
        prereg(rest[:at] + rest[at + 2:], rest[at + 1])
    elif command == "run":
        run(rest[0])
    elif command == "score":
        score()
    else:
        raise SystemExit(__doc__)
