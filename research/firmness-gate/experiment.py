"""Firmness gate on the October AMI evaluation: design on dev, preregister, run the test split once.

    export MEMORIA_QWEN_SOCKET=...                      # only needed while scores are not cached (--live)
    python3.11 experiment.py dev [--live]               # wording, ablation and tau curve on dev -> results/dev.json
    python3.11 experiment.py prereg                     # preregistration.json from the dev choice; prints its SHA-256
    python3.11 experiment.py test [--live]              # the single test run -> results/test.json (refuses a second run)
    python3.11 experiment.py test --replay              # recompute the test run from the caches and check it is identical
"""
import argparse
import hashlib
import json
import math
import statistics
import sys
import time
from pathlib import Path

import gate as G
import replay
from memoria_engine.evaluation.metrics import auroc, paired_sign_test
from replay_offline import comparable

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
SCORES = RESULTS / "gate_scores.jsonl"
PREREG = HERE / "preregistration.json"
CONFIGS = (("w1", "context"), ("w2", "context"), ("w1", "quote"), ("w2", "quote"))
GRID = tuple(range(-8, 9))
OFF = -math.inf
TYPES = ("overall", "current", "as_of_valid", "n_changes")
CODE = ("gate.py", "replay.py", "experiment.py")


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def summary(report):
    qa, e = report["qa"]["ext+router"], report["extraction"]
    return {"qa": {k: qa[k]["correct"] for k in TYPES}, "n": {k: qa[k]["n"] for k in TYPES},
            "tp": e["tp"], "fp": e["fp"], "fn": e["fn"], "precision": e["precision"], "recall": e["recall"], "f1": e["f1"],
            "fp_reasons": e["fp_reasons"], "state_correct": report["ledger"]["state_correct"]}


def events(trace, gate):
    """Every event that reached the October ledger, with its gold match, gate score and (review runs) the reviewer's call."""
    rows = []
    for t in trace.values():
        chain = t["chain"]
        for gm, res in zip(chain.meetings, t["october"]["results"]):
            for d, gold in replay.gold_matches(gm, res, chain.registry):
                rec = gate.record(gm.meeting, chain.registry, d)
                rows.append({"meeting": gm.meeting.meeting_id, "turn": d.turn, "slot": f"{d.object_id}.{d.attribute}", "value": d.value,
                             "quote": gm.meeting.text[d.span[0]:d.span[1]], "gold": gold, "status": d.status, "review": d.review,
                             "conflict": d.conflict, "score": rec["score"], "seconds": rec["seconds"]})
    return rows


def flags(report):
    return [((r["chain"], r["qid"]), r["answers"]["ext+router"]["correct"]) for r in report["rows"]]


def sign_test(gated, october):
    a, b = flags(gated), flags(october)
    assert [k for k, _ in a] == [k for k, _ in b]
    return paired_sign_test([x for _, x in a], [x for _, x in b])


def burden(trace, which):
    per = [sum(d.status == "proposed" for d in res.dispositions) for t in trace.values() for res in t[which]["results"]]
    return {"total": sum(per), "per_meeting": round(sum(per) / len(per), 2), "max": max(per), "meetings": len(per)}


def reach_per_meeting(trace, which):
    per = [sum(d.status in replay.REACH for d in res.dispositions) for t in trace.values() for res in t[which]["results"]]
    return round(sum(per) / len(per), 2)


def select(curve):
    """Pre-declared rule: best dev QA (ext+router); ties -> best extraction F1; ties -> tau closest to 0, then the lower."""
    return max(curve, key=lambda r: (r["qa"]["overall"], r["f1"] or 0.0, -abs(r["tau"]), -r["tau"]))


def latency(rows):
    secs = sorted(r["seconds"] for r in rows)
    return {"events": len(secs), "median_s": round(statistics.median(secs), 3), "mean_s": round(statistics.fmean(secs), 3),
            "p90_s": round(secs[int(0.9 * (len(secs) - 1))], 3), "max_s": round(secs[-1], 3)}


# ---- dev -----------------------------------------------------------------------------------------------------------

def dev(live):
    scores = G.Scores(SCORES, live)
    october, _ = replay.run("dev", "immediate")
    out = {"date": time.strftime("%Y-%m-%d %H:%M:%S"), "october": summary(october), "configs": {}}
    for wording, variant in CONFIGS:
        _, trace = replay.run("dev", "immediate", G.Gate(scores, wording, variant, OFF))  # gate off: scores every event once
        rows = events(trace, G.Gate(scores, wording, variant, OFF))
        curve = []
        for tau in GRID:
            report, _ = replay.run("dev", "immediate", G.Gate(scores, wording, variant, tau))
            curve.append({"tau": tau, "kept": sum(r["score"] >= tau for r in rows), **summary(report)})
        pos, neg = [r["score"] for r in rows if r["gold"]], [r["score"] for r in rows if not r["gold"]]
        out["configs"][f"{wording}/{variant}"] = {"wording": wording, "variant": variant, "prompt_sha256": G.prompt_sha(wording, variant),
                                                  "auroc": auroc(pos, neg), "positives": len(pos), "negatives": len(neg),
                                                  "latency": latency(rows), "curve": curve, "events": rows}
        print(f"{wording}/{variant}: AUROC {auroc(pos, neg):.3f} ({len(pos)} gold-matched, {len(neg)} other); scored live {scores.calls}", flush=True)
    context = [c for c in out["configs"].values() if c["variant"] == "context"]
    chosen = max(context, key=lambda c: (c["auroc"], c["wording"] == "w1"))
    best = select(chosen["curve"])
    out["choice"] = {"wording": chosen["wording"], "variant": "context", "tau": best["tau"], "prompt_sha256": chosen["prompt_sha256"],
                     "dev_at_tau": {k: best[k] for k in ("kept", "qa", "tp", "fp", "fn", "precision", "recall", "f1")}}
    ablation = out["configs"][f"{chosen['wording']}/quote"]
    out["ablation"] = {"context": {"auroc": chosen["auroc"], "at_tau": best},
                       "quote": {"auroc": ablation["auroc"], "at_tau": next(r for r in ablation["curve"] if r["tau"] == best["tau"]),
                                 "best": select(ablation["curve"])}}
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "dev.json").write_text(json.dumps(out, indent=1, default=str))
    print_dev(out)


def print_dev(out):
    o = out["october"]
    print(f"\nOctober dev: QA {o['qa']['overall']}/45, P {o['precision']:.3f} R {o['recall']:.3f} F1 {o['f1']:.3f}")
    for name, c in out["configs"].items():
        print(f"\n{name}  AUROC {c['auroc']:.3f}  latency {c['latency']}\n tau kept  TP  FP  FN     P     R    F1   QA cur asof chg")
        for r in c["curve"]:
            q = r["qa"]
            print(f" {r['tau']:>3} {r['kept']:>4} {r['tp']:>3} {r['fp']:>3} {r['fn']:>3} {r['precision'] or 0:.3f} {r['recall']:.3f} {r['f1'] or 0:.3f}"
                  f" {q['overall']:>4} {q['current']:>3} {q['as_of_valid']:>4} {q['n_changes']:>3}")
    print("\nchoice:", json.dumps(out["choice"]))


# ---- preregistration -----------------------------------------------------------------------------------------------

def prereg():
    if PREREG.exists():
        sys.exit(f"{PREREG.name} exists (SHA-256 {sha256(PREREG)}); it is written once")
    d = json.loads((RESULTS / "dev.json").read_text())
    c = d["choice"]
    scores = G.Scores(SCORES)
    october, _ = replay.run("dev", "immediate")
    chosen, _ = replay.run("dev", "immediate", G.Gate(scores, c["wording"], c["variant"], c["tau"]))
    doc = {
        "title": "Firmness gate between extraction and ledger, AMI test split, single run",
        "date": time.strftime("%Y-%m-%d %H:%M:%S %Z"),
        "gate": {"wording": c["wording"], "variant": c["variant"], "tau": c["tau"], "keep_if": "log P(YES) - log P(NO) of the first token >= tau",
                 "prompt_sha256": c["prompt_sha256"], "system": G.SYSTEM, "user_template": G.TEMPLATE, "question": G.WORDINGS[c["wording"]],
                 "context_turns_before_after_clip": [G.BEFORE, G.AFTER, G.CLIP], "model": G.MODEL,
                 "scorer": "src-tauri/resources/memory/qwen_scoring.py first_token_logprobs (YES - NO), app worker via MEMORIA_QWEN_SOCKET"},
        "chosen_on_dev": {"rule": "wording: higher dev AUROC (gold-matched vs other events reaching the ledger), context variant; "
                                  "tau: integer grid -8..8 maximising dev QA (ext+router), ties by dev extraction F1, then |tau| smallest",
                          "dev_auroc": {k: round(v["auroc"], 3) for k, v in d["configs"].items()},
                          "dev_at_tau": c["dev_at_tau"], "dev_october": d["october"], "dev_sign_test_vs_october": sign_test(chosen, october),
                          "caveat": "dev AUROC is near chance for every configuration and the dev QA gain is one grid point wide; a null test result is the expected outcome"},
        "test": {"split": "test (ES2004, ES2014, IS1009, TS3003, TS3007): 20 meetings, 96 questions, 46 gold events",
                 "extraction": "October candidates replayed from results/cache (ami_test_memoria.jsonl; review: ami_test_memoria_review.jsonl); a cache miss stops the run",
                 "primary": "QA accuracy, ext+router, 96 questions, gated vs October ledger (59/96); exact two-sided paired sign test",
                 "secondary": ["accuracy per question type (current, as_of_valid, n_changes) vs October 18/34, 29/29, 12/33",
                               "extraction precision, recall, F1 vs gold (October 21%, 67%, 32%)",
                               "suggestions a reviewer sees per meeting, confirm_conflicts with the perfect reviewer (October 1.75), and the app's confirm_all",
                               "perfect-reviewer QA (October 85/96), sign test; accepted proposals the gate removes",
                               "gate latency per event"],
                 "hypothesis": "fewer spurious events, higher current and n_changes accuracy, fewer suggestions, small recall loss"},
        "code_sha256": {f: sha256(HERE / f) for f in CODE},
        "data_sha256": {p.name: sha256(p) for p in sorted((replay.ENGINE / "data" / "ami_v0").glob("*.chain"))},
        "cache_sha256": {Path(p).name: sha256(replay.ENGINE / p) for p in sorted(set(replay.CACHE.values()))},
        "gate_scores_sha256_at_preregistration": sha256(SCORES),
    }
    PREREG.write_text(json.dumps(doc, indent=1) + "\n")
    print(f"wrote {PREREG}\nSHA-256 {sha256(PREREG)}")


# ---- the test run ----------------------------------------------------------------------------------------------------

def test(live, replay_only):
    p = json.loads(PREREG.read_text())
    changed = [f for f, h in p["code_sha256"].items() if sha256(HERE / f) != h]
    if changed:
        sys.exit(f"code changed since the preregistration: {changed}")
    out_path = RESULTS / "test.json"
    if out_path.exists() and not replay_only:
        sys.exit("the test split has been run once (results/test.json); use --replay to recompute it from the caches")
    g = p["gate"]
    scores = G.Scores(SCORES, live and not replay_only)
    make = lambda: G.Gate(scores, g["wording"], g["variant"], g["tau"])
    out = {"preregistration_sha256": sha256(PREREG), "gate": {k: g[k] for k in ("wording", "variant", "tau", "prompt_sha256")}}
    for name, policy, gated_policy in (("immediate", "immediate", "immediate"), ("review", "confirm_conflicts", "confirm_conflicts"),
                                       ("inbox_confirm_all", "confirm_conflicts", "confirm_all")):
        october, otrace = replay.run("test", policy, gated_policy=gated_policy)
        if gated_policy == policy:
            stored = json.loads((replay.ENGINE / replay.STORED[("test", policy)]).read_text())
            assert comparable(stored) == comparable(json.loads(json.dumps({"memoria": october}, default=str))), "gate-off replay differs from October"
        gate = make()
        gated, trace = replay.run("test", policy, gate, gated_policy=gated_policy)
        rows = events(trace, make()) if name != "inbox_confirm_all" else []
        out[name] = {"october": summary(october), "gated": summary(gated), "sign_test": sign_test(gated, october),
                     "qa_october": october["qa"]["ext+router"], "qa_gated": gated["qa"]["ext+router"],
                     "burden_october": burden(otrace, "gated"), "burden_gated": burden(trace, "gated"),
                     "reach_per_meeting_october": reach_per_meeting(otrace, "gated"), "reach_per_meeting_gated": reach_per_meeting(trace, "gated"),
                     "drift_meetings": sorted(m for t in trace.values() for m in t["drift"]), "cache": gated["cache"], "events": rows,
                     "wrong_gated": [{"chain": r["chain"], "qid": r["qid"], "type": r["type"], "gold": r["gold"], "answer": r["answers"]["ext+router"]["answer"]}
                                     for r in gated["rows"] if not r["answers"]["ext+router"]["correct"]]}
        print(f"{name}: live gate calls so far {scores.calls}", flush=True)
    rows = out["immediate"]["events"]
    out["latency"] = latency(rows)
    out["latency"]["per_meeting_s"] = round(sum(r["seconds"] for r in rows) / 20, 2)
    rev = out["review"]["events"]
    accepted = [r for r in rev if r["review"] in ("accepted", "accepted_edited")]
    out["review_accepted_removed"] = {"accepted_by_reviewer": len(accepted),
                                      "removed_by_gate": sum(r["score"] < g["tau"] for r in accepted),
                                      "items": [r for r in accepted if r["score"] < g["tau"]]}
    if replay_only:
        stored = json.loads(out_path.read_text())
        same = json.loads(json.dumps({k: v for k, v in out.items()}, default=str)) == {k: v for k, v in stored.items() if k in out}
        print("REPLAY IDENTICAL to results/test.json" if same else "REPLAY DIFFERS from results/test.json")
        return
    out["date"] = time.strftime("%Y-%m-%d %H:%M:%S")
    out_path.write_text(json.dumps(out, indent=1, default=str))
    print_test(out)


def f3(x):
    return "-" if x is None else f"{x:.3f}"


def print_test(out):
    for name in ("immediate", "review"):
        o, s = out[name]["october"], out[name]["gated"]
        print(f"\n{name}: QA {o['qa']['overall']} -> {s['qa']['overall']} of {o['n']['overall']} | " +
              " | ".join(f"{k} {o['qa'][k]}->{s['qa'][k]}/{o['n'][k]}" for k in TYPES[1:]) +
              f" | TP {o['tp']}->{s['tp']} FP {o['fp']}->{s['fp']} | P {f3(o['precision'])}->{f3(s['precision'])} "
              f"R {f3(o['recall'])}->{f3(s['recall'])} F1 {f3(o['f1'])}->{f3(s['f1'])} | sign {out[name]['sign_test']}")
        print(f"  suggestions/meeting {out[name]['burden_october']['per_meeting']} -> {out[name]['burden_gated']['per_meeting']}; drift {len(out[name]['drift_meetings'])} meetings")
    i = out["inbox_confirm_all"]
    print(f"\napp inbox (confirm_all): {i['burden_october']['per_meeting']} -> {i['burden_gated']['per_meeting']} per meeting")
    print("latency", out["latency"], "\naccepted proposals removed", {k: v for k, v in out["review_accepted_removed"].items() if k != "items"})


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("step", choices=("dev", "prereg", "test"))
    ap.add_argument("--live", action="store_true", help="score uncached events with the app's Qwen worker")
    ap.add_argument("--replay", action="store_true", help="test: recompute from the caches and compare with results/test.json")
    a = ap.parse_args()
    {"dev": lambda: dev(a.live), "prereg": prereg, "test": lambda: test(a.live, a.replay)}[a.step]()
