"""Fuzz campaign behind the robustness claims of chapter 6.3. Run from the engine directory:

    /opt/homebrew/bin/python3.11 results/testing/evidence/fuzz_campaign.py OUTPUT.json

Layer 1 sends 18,000 textual and 24,000 structural mutations of a valid model reply to parse_events.
Layer 2 sends 11 recorded test-split meetings x 300 mutations of the real model reply through the whole pipeline
(parse, ground, validate, commit), each run into a fresh ledger, under three review policies.
Seeds are fixed, no model is loaded and nothing touches the network. The mutators are those of tests/test_error_handling.py.
"""
import json
import random
import sys
import time
from collections import Counter

sys.path.insert(0, ".")
sys.path.insert(0, "tests")
import test_error_handling as T  # noqa: E402  (only its helpers are used)
from memoria_engine.evaluation.dataset import load_chains  # noqa: E402
from memoria_engine.extractors import parse_events  # noqa: E402
from memoria_engine.pipeline import Pipeline, make_policy  # noqa: E402

SEED = 20260301
POLICIES = ("immediate", "confirm_all", "threshold:0.8")


def parse_layer():
    rng = random.Random(SEED)
    valid_reply = T.reply(*T.GOOD)
    document = {"events": T.GOOD}
    raised, runs = Counter(), Counter()
    for kind, count in (("textual", 18000), ("structural", 24000)):
        for _ in range(count):
            text = T.mutate_text(rng, valid_reply) if kind == "textual" else json.dumps(T.mutate_structure(rng, document))
            runs[kind] += 1
            try:
                found, clean = parse_events(text)
                assert isinstance(found, list) and isinstance(clean, bool)
            except BaseException as exc:
                raised[f"{kind}:{type(exc).__name__}"] += 1
    return {"runs": dict(runs), "exceptions": dict(raised), "exception_total": sum(raised.values())}


class Recorded:
    name = "recorded"

    def __init__(self, text):
        self.text = text

    def extract(self, ctx):
        return parse_events(self.text)[0]


def pipeline_layer():
    rng = random.Random(SEED)
    audit = json.load(open("results/test_v2.json"))["pipeline"]["immediate"]["audit"]
    chains = {c.chain_id: c for c in load_chains("data/pilot_v0", "ask")}
    raised, examples = Counter(), {}
    runs = invariant_violations = traceability_violations = half_applied = applied = 0
    statuses = Counter()
    for entry in audit:
        chain = chains[entry["chain"]]
        meeting = next(g.meeting for g in chain.meetings if g.meeting.meeting_id == entry["meeting"])
        raw = entry["stats"]["raw"]
        try:
            document = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
        except ValueError:
            document = None
        for i in range(300):
            text = json.dumps(T.mutate_structure(rng, document)) if document is not None and i % 2 == 0 else T.mutate_text(rng, raw)
            pipe = Pipeline(chain.registry, Recorded(text), make_policy(POLICIES[i % 3]))
            runs += 1
            try:
                result = pipe.ingest(meeting)
            except BaseException as exc:
                name = type(exc).__name__
                raised[name] += 1
                examples.setdefault(name, str(exc)[:140])
                half_applied += bool(pipe.ledger.dump()["facts"] or pipe.ledger.dump()["proposals"])
                continue
            statuses.update(d.status for d in result.dispositions)
            applied += sum(d.status == "applied" for d in result.dispositions)
            invariant_violations += bool(pipe.ledger.check_invariants())
            for obj, attr in pipe.registry.slots():
                for row in pipe.ledger.history(obj, attr):
                    for e in row["evidence"]:
                        if meeting.text[e["char_start"]:e["char_end"]] != e["span_text"]:
                            traceability_violations += 1
    return {"runs": runs, "exceptions": dict(raised), "exception_total": sum(raised.values()),
            "exception_examples": examples, "runs_that_raised_after_part_of_the_meeting_was_stored": half_applied,
            "invariant_violations": invariant_violations, "traceability_violations": traceability_violations,
            "dispositions": dict(statuses), "facts_applied": applied}


if __name__ == "__main__":
    started = time.time()
    out = {"seed": SEED, "policies": POLICIES, "parse_events": parse_layer(), "pipeline": pipeline_layer()}
    out["seconds"] = round(time.time() - started, 1)
    json.dump(out, open(sys.argv[1], "w"), indent=1, sort_keys=True)
    p, q = out["parse_events"], out["pipeline"]
    print(f"parse_events: {sum(p['runs'].values())} mutations, {p['exception_total']} exceptions {p['exceptions']}")
    print(f"pipeline: {q['runs']} mutated replies, {q['exception_total']} exceptions {q['exceptions']}, "
          f"{q['runs_that_raised_after_part_of_the_meeting_was_stored']} left a half-ingested meeting, "
          f"{q['invariant_violations']} invariant violations, {q['traceability_violations']} evidence mismatches")
