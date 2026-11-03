"""Prospective chronology tests in the material domain so the shadow vocabulary is active."""
import json
import resource
import signal
import time

from r2_common import HERE, harness, sha, verify_round1, write_json
from experiment import Runtime, preflight, timeout
from generation import request, effective_text, shadow_prompt
from memoria_engine.pipeline import AttributeSpec, Candidate, Meeting, ObjectSpec, Pipeline, Registry, Turn, make_policy
from memoria_engine.ledger import ts

VALUES = ("plastic", "rubber", "wood")
REG = Registry({"case_material": ObjectSpec("case_material", "decision", "Material of the remote control case",
                                          (AttributeSpec("outcome", "enum", VALUES, "REVISE"),))},
               {"a": "Aisha", "r": "Raj"})
REG_BOTH = Registry({**REG.objects, "button_material": ObjectSpec("button_material", "decision", "Material of the remote control buttons",
                                                               (AttributeSpec("outcome", "enum", VALUES, "REVISE"),))}, REG.people)


def meeting(name, date, rows):
    occurred = ts(f"2026-{date}T09:00:00Z")
    return Meeting(name, occurred, occurred+3*3600*1_000_000,
                   tuple(Turn(i, who, float(seconds), text) for i, (seconds, who, text) in enumerate(rows)))


PRIOR = meeting("prior", "09-01", [(30, "a", "We choose plastic as the case material.")])
FIXTURES = [
    ("two_material_changes", REG, meeting("test", "09-15", [
        (60, "r", "We approve changing the case material to rubber."),
        (900, "a", "Next item: training dates."),
        (1800, "r", "After the prototype review, we approve a further change of the case material to wood.")]),
     {"case_material": "wood", "case_changes": 2, "at_500": "rubber", "at_2000": "wood"}),
    ("recaps_then_material_change", REG, meeting("test", "09-15", [
        (60, "a", "As agreed last time, the case material is plastic."),
        (400, "r", "Right, plastic is the case material in the current design."),
        (800, "a", "For now we stay with plastic as the case material."),
        (1500, "r", "The drop test failed."),
        (1700, "a", "Decision: we switch the case material to rubber, effective today.")]),
     {"case_material": "rubber", "case_changes": 1}),
    ("unchanged_case_untracked_buttons", REG, meeting("test", "09-15", [
        (60, "a", "The case material is still plastic."),
        (400, "r", "No change to the case material: plastic."),
        (800, "a", "The case remains plastic."),
        (1700, "r", "We will use wood for the buttons.")]),
     {"case_material": "plastic", "case_changes": 0}),
    ("registered_button_decision_retained", REG_BOTH, meeting("test", "09-15", [
        (60, "a", "The case material is still plastic."),
        (1700, "r", "We will use wood for the buttons.")]),
     {"case_material": "plastic", "button_material": "wood", "case_changes": 0}),
]


def main():
    verify_round1()
    write_json(HERE / "data/material-contract-freeze.json", {
        "time": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "source_code_sha256": sha(__import__("pathlib").Path(__file__).read_bytes()),
        "fixtures": [{"name": n, "transcript": m.text, "expected": e} for n, reg, m, e in FIXTURES]})
    check = preflight()
    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(450)
    rt = Runtime()
    rows = []
    try:
        for condition in ("base", "shadow"):
            for name, reg, m, expected in FIXTURES:
                records = []

                class LM:
                    def app_generate(self, prompt, max_tokens=1800, system=None, tag=None):
                        record = request(rt, prompt, system, condition, name)
                        records.append({**record, "prompt": prompt})
                        return {**record, "text": effective_text(record)}

                inner = harness.AppExtractor(LM())

                class Extractor:
                    name, last_stats = "round2-material-contract", {}

                    def extract(self, ctx):
                        if ctx.meeting.meeting_id == "prior":
                            return [Candidate("case_material", "outcome", "plastic", PRIOR.turns[0].text, 0)]
                        return inner.extract(ctx)

                pipe = Pipeline(reg, Extractor(), make_policy("immediate"))
                pipe.ingest(PRIOR)
                pipe.ingest(m)
                now = ts("2026-12-01T00:00:00Z")
                actual = {}
                for key in expected:
                    if key == "case_changes":
                        pieces = pipe.ledger.timeline("case_material", "outcome")
                        actual[key] = sum(a.value != b.value for a, b in zip(pieces, pieces[1:]))
                    elif key.startswith("at_"):
                        belief = pipe.ledger.as_of("case_material", "outcome", valid_at=m.occurred_at + int(key[3:])*1_000_000)
                        actual[key] = belief.value if belief else None
                    else:
                        belief = pipe.ledger.as_of(key, "outcome", valid_at=now)
                        actual[key] = belief.value if belief else None
                result = {"condition": condition, "fixture": name, "expected": expected, "actual": actual,
                          "passed": actual == expected, "records": records}
                rows.append(result)
                print(json.dumps({k: result[k] for k in ("condition", "fixture", "passed", "actual")}), flush=True)
        write_json(HERE / "results/contracts-shadow.json", {"preflight": check, "rows": rows,
                                                            "peak_process_rss_gb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1e9})
    finally:
        rt.close()
        signal.alarm(0)
        print(json.dumps({"closed": True, "seconds": time.perf_counter()-rt.started}), flush=True)


if __name__ == "__main__":
    main()
