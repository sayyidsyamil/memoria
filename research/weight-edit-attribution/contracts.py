"""Run the coordinator's chronology fixtures through actual extraction, plus scoped restoration checks."""
import importlib.util
import json
import resource
import signal
import sys
import time

from common import HERE, ROOT, harness, load_dev, sha, write_json
from experiment import Runtime, install, preflight, timeout
from extract_screen import generate
from lm import APP_SYSTEM
from memoria_engine.pipeline import Candidate, Pipeline, make_policy


def fixtures():
    source = ROOT.parent / "memoria-wt-models/research/model-improvements/test_modevalue_contract.py"
    frozen = HERE / "data/chronology-fixtures.py"
    if not frozen.exists():
        data = source.read_bytes()
        frozen.write_bytes(data)
        write_json(HERE / "data/chronology-fixtures-source.json", {"source": str(source), "sha256": sha(data),
                                                                 "time": time.strftime("%Y-%m-%dT%H:%M:%S%z")})
    spec = importlib.util.spec_from_file_location("frozen_chronology_fixtures", frozen)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod, [
        ("two_changes", mod.PRIOR_BUDGET, mod.TwoRealChangesInOneMeeting, ("budget", "amount")),
        ("recaps_then_switch", mod.PRIOR_VENDOR, mod.RecapsThenOneFinalDecision, ("vendor", "outcome")),
        ("unchanged_recaps", mod.PRIOR_VENDOR, mod.RepeatedUnchangedValue, ("vendor", "outcome")),
    ]


def outcome(mod, fixture, pipe, slot):
    got = mod.outcome(pipe, slot)
    expected = fixture.expected
    passed = all(got[k] == v for k, v in expected.items())
    at_claim_times = {}
    if slot[0] == "budget":
        for seconds, value in ((500, 280000), (2000, 300000)):
            belief = pipe.ledger.as_of(*slot, valid_at=fixture.m1.occurred_at + seconds*1_000_000)
            found = belief.value if belief else None
            at_claim_times[str(seconds)] = {"expected": value, "actual": found}
            passed = passed and found == value
    return {"expected": expected, "actual": got, "claim_times": at_claim_times, "passed": passed}


def no_model():
    mod, fs = fixtures()
    rows = []
    for name, prior, fixture, slot in fs:
        pipe = mod.run([prior, fixture.m1], fixture.candidates)
        rows.append({"fixture": name, **outcome(mod, fixture, pipe, slot)})
    assert all(r["passed"] for r in rows)
    write_json(HERE / "results/chronology-no-model.json", rows)
    print(json.dumps(rows, indent=2))


def model_run(conditions=("base", "context", "binding", "target", "random")):
    check = preflight()
    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(450)
    rt = Runtime()
    rows, regressions = [], []
    mod, fs = fixtures()
    import live_guard
    guard_messages = [live_guard.question("We will use Beta.", "The vendor is Alpha."),
                      live_guard.question("The case is plastic.", "Case material is plastic.")]
    guard_before = [rt.score(m)[0] for m in guard_messages]
    from memoria_engine.evaluation.router import build_prompt
    from memoria_engine.evaluation.baselines import today_iso
    chain = load_dev(["ES2003"])[0]
    route_prompt = build_prompt(chain.registry, today_iso(chain), chain.questions[0].ask)
    ask_window = {"key": sha(route_prompt), "prompt": route_prompt, "system": APP_SYSTEM, "meeting": "ask-route-regression"}
    ask_before = generate(rt, ask_window, "scope-regression")
    try:
        for condition in conditions:
            restore = install(rt, -.5 if condition == "amplify" else .5, random=condition == "random") if condition in ("target", "random", "amplify") else None
            try:
                for name, prior, fixture, slot in fs:
                    recorded = []

                    class FixtureLM:
                        def app_generate(self, prompt, max_tokens=1800, system=None, tag=None):
                            window = {"key": sha(json.dumps([prompt, system, max_tokens])), "prompt": prompt,
                                      "system": system, "meeting": f"{name}:{tag}"}
                            row = generate(rt, window, condition)
                            recorded.append({**row, "prompt": prompt})
                            return row

                    inner = harness.AppExtractor(FixtureLM())

                    class FixtureExtractor:
                        name, last_stats = "chronology-fixture-extraction", {}

                        def extract(self, ctx):
                            if ctx.meeting.meeting_id == "m0":
                                return [Candidate(*c) for c in fixture.candidates["m0"]]
                            return inner.extract(ctx)

                    pipe = Pipeline(mod.REGISTRY, FixtureExtractor(), make_policy("immediate"))
                    pipe.ingest(prior)
                    result = pipe.ingest(fixture.m1)
                    row = {"condition": condition, "fixture": name, **outcome(mod, fixture, pipe, slot),
                           "records": recorded, "dispositions": [{"status": d.status, "turn": d.turn,
                              "object_id": d.object_id, "attribute": d.attribute, "value": d.value} for d in result.dispositions]}
                    rows.append(row)
                    print(json.dumps({k: row[k] for k in ("condition", "fixture", "passed", "actual")}), flush=True)
            finally:
                if restore:
                    restore()
        for i, messages in enumerate(guard_messages):
            after = rt.score(messages)[0]
            regressions.append({"task": f"guard-{i}", "identical": guard_before[i]["logprobs"] == after["logprobs"],
                                "before": guard_before[i], "after": after})
        ask_after = generate(rt, ask_window, "scope-regression")
        regressions.append({"task": "Ask router", "identical": ask_before["text"] == ask_after["text"],
                            "before": ask_before, "after": ask_after})
        suffix = "-amplify" if tuple(conditions) == ("amplify",) else ""
        write_json(HERE / f"results/chronology-model{suffix}.json", {"rows": rows, "scoped_restoration": regressions,
                                                            "process_peak_rss_gb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1e9})
    finally:
        rt.close()
        signal.alarm(0)
        print(json.dumps({"closed": True, "preflight": check, "seconds": time.perf_counter()-rt.started}), flush=True)


if __name__ == "__main__":
    no_model() if sys.argv[1] == "no-model" else model_run(tuple(sys.argv[2:]) if len(sys.argv) > 2 else ("base", "context", "binding", "target", "random"))
