"""Post-hoc controls, run after the single test run. NOT preregistered; no model calls; nothing is tuned on test.

1. Matched random thinning: remove as many events as the gate did, at random (over all events, and per meeting with
   the gate's per-meeting counts), 1000 times each. Is the gate better than simply writing fewer events?
2. The extractor's own confidence as a free gate; threshold chosen on dev with the preregistered rule.
3. AUROC of the gate score on test (gold-matched events, and events whose value agrees with gold).

    python3.11 posthoc.py            -> results/posthoc.json
"""
import json
import random
import statistics
from collections import Counter, defaultdict

import experiment as E
import gate as G
import replay
from memoria_engine.evaluation.metrics import auroc
from memoria_engine.evaluation.oracle import values_equal

SAMPLES = 1000


def key(meeting, d):
    return (meeting.meeting_id, d.turn, d.object_id, d.attribute, str(d.value), tuple(d.span))


def pool_and_scores(split, gate):
    """Every event the gate is asked about, in order, with its score."""
    seen = {}

    def keep(meeting, registry, d):
        seen[key(meeting, d)] = gate.record(meeting, registry, d)["score"]
        return True

    replay.run(split, "immediate", keep)
    return seen


def wrong_value(report):
    """Current-value questions answered with a value that is wrong (not 'nothing recorded')."""
    return sum(1 for r in report["rows"] if r["type"] == "current" and not r["answers"]["ext+router"]["correct"]
               and r["answers"]["ext+router"]["answer"] is not None)


def thinning(split, scores, tau, per_meeting, seed=0):
    rnd, pool = random.Random(seed), list(scores)
    removed = [k for k in pool if scores[k] < tau]
    by_meeting = defaultdict(list)
    for k in pool:
        by_meeting[k[0]].append(k)
    quota = Counter(k[0] for k in removed)
    row = lambda report, s: {"qa": s["qa"]["overall"], "current": s["qa"]["current"], "n_changes": s["qa"]["n_changes"], "tp": s["tp"], "fp": s["fp"],
                             "current_wrong_value": wrong_value(report)}
    runs = []
    for _ in range(SAMPLES):
        if per_meeting:
            drop = {k for m, items in by_meeting.items() for k in rnd.sample(items, quota[m])}
        else:
            drop = set(rnd.sample(pool, len(removed)))
        report, _ = replay.run(split, "immediate", lambda m, r, d, drop=drop: key(m, d) not in drop)
        runs.append(row(report, E.summary(report)))
    gate_report, _ = replay.run(split, "immediate", lambda m, r, d: scores[key(m, d)] >= tau)
    october, _ = replay.run(split, "immediate")
    g, qa = row(gate_report, E.summary(gate_report)), sorted(r["qa"] for r in runs)
    return {"removed": len(removed), "of": len(pool), "per_meeting": per_meeting, "samples": SAMPLES,
            "october": row(october, E.summary(october)), "gate": g,
            "random_mean": {k: round(statistics.fmean(r[k] for r in runs), 2) for k in runs[0]},
            "random_qa_95": [qa[int(0.025 * SAMPLES)], qa[int(0.975 * SAMPLES) - 1]],
            "share_random_qa_at_least_gate": sum(q >= g["qa"] for q in qa) / SAMPLES}


def confidence_gate():
    def run(split, c):
        report, _ = replay.run(split, "immediate", lambda m, r, d: (d.candidate.confidence or 0.0) >= c)
        return {"threshold": c, **E.summary(report)}

    grid = (0.0, 0.5, 0.8, 0.9)
    curve = [run("dev", c) for c in grid]
    best = max(curve, key=lambda r: (r["qa"]["overall"], r["f1"] or 0.0, -r["threshold"]))
    return {"dev_curve": [{k: r[k] for k in ("threshold", "qa", "tp", "fp", "f1")} for r in curve], "chosen_on_dev": best["threshold"],
            "test": {k: v for k, v in run("test", best["threshold"]).items() if k != "fp_reasons"}}


def test_auroc(tau_events):
    chains = {c.chain_id: c for c in replay.chains("test")}

    def gold_after(meeting, slot):
        value = None
        for gm in chains[meeting[:-1]].meetings:
            value = next((e.value for e in reversed(gm.events) if f"{e.object_id}.{e.attribute}" == slot), value)
            if gm.meeting.meeting_id == meeting:
                return value

    agrees = lambda r: gold_after(r["meeting"], r["slot"]) is not None and values_equal(r["value"], gold_after(r["meeting"], r["slot"]))
    return {"gold_matched": auroc([r["score"] for r in tau_events if r["gold"]], [r["score"] for r in tau_events if not r["gold"]]),
            "value_agrees_with_gold": auroc([r["score"] for r in tau_events if agrees(r)], [r["score"] for r in tau_events if not agrees(r)]),
            "n_agree": sum(agrees(r) for r in tau_events), "n": len(tau_events)}


if __name__ == "__main__":
    prereg = json.loads(E.PREREG.read_text())["gate"]
    gate = G.Gate(G.Scores(E.SCORES), prereg["wording"], prereg["variant"], prereg["tau"])
    out = {"note": "post hoc, not preregistered; no model calls"}
    for split in ("dev", "test"):
        scores = pool_and_scores(split, gate)
        out[f"thinning_{split}"] = [thinning(split, scores, prereg["tau"], per_meeting) for per_meeting in (False, True)]
        print(split, json.dumps(out[f"thinning_{split}"]), flush=True)
    out["confidence_gate"] = confidence_gate()
    print(json.dumps(out["confidence_gate"]), flush=True)
    out["test_auroc"] = test_auroc(json.loads((E.RESULTS / "test.json").read_text())["immediate"]["events"])
    print(json.dumps(out["test_auroc"]))
    (E.RESULTS / "posthoc.json").write_text(json.dumps(out, indent=1))
