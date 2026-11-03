"""Product-contract counterexamples for candidate A's per-meeting rule (no model, development-only fixtures).

    python3.11 test_modevalue_contract.py

The engine keeps chronology inside a meeting: `pipeline.Pipeline._commit` gives every write the claim time
meeting.occurred_at + turn.start, commits in turn order and compares each write with the belief in force at that
moment, so two real changes in one meeting are two facts and the later one is current. Candidate A
(`app-nosys-numwords-loopstop+modevalue`) applies `modevalue` to each meeting's candidates before they are written
(`harness._Gated`, the closed loop A was frozen with): a slot keeps only the value written most often in the meeting,
ties going to the later write. These fixtures inject known candidates, run the real pipeline once as shipped and once
through A's gate, and state the expected product behaviour; they are not tuned to any outcome. Each fixture also runs
the rule `revertonly` (a different, unfrozen idea, see README) for comparison.
"""
import sys
import unittest
from types import SimpleNamespace

sys.dont_write_bytecode = True
import harness  # noqa: E402  (puts the app's memory folder on the path)
from memoria_engine.evaluation.oracle import values_equal  # noqa: E402
from memoria_engine.ledger import ts  # noqa: E402
from memoria_engine.pipeline import AttributeSpec, Candidate, Meeting, ObjectSpec, Pipeline, Registry, Turn, make_policy  # noqa: E402

REGISTRY = Registry({
    "budget": ObjectSpec("budget", "decision", "Pilot budget (RM)", (AttributeSpec("amount", "number"),)),
    "vendor": ObjectSpec("vendor", "decision", "Pilot vendor", (AttributeSpec("outcome", "enum", ("Alpha", "Beta", "Gamma"), "REVERSE"),)),
}, {"aisha": "Aisha", "raj": "Raj"})
CHAIN = SimpleNamespace(registry=REGISTRY)
NOW = ts("2026-12-01T00:00:00Z")


def meeting(meeting_id, day, lines):
    """lines: [(seconds from start, speaker, text)]"""
    occurred = ts(f"2026-{day}T09:00:00Z")
    return Meeting(meeting_id, occurred, occurred + 3 * 3600 * 1_000_000,
                   tuple(Turn(i, speaker, float(start), text) for i, (start, speaker, text) in enumerate(lines)))


class Injected:
    """The extractor's candidates for each meeting, fixed in advance (what a model would have proposed)."""
    name = "fixture"
    last_stats = {}

    def __init__(self, by_meeting):
        self.by_meeting = by_meeting

    def extract(self, ctx):
        return [Candidate(*c) for c in self.by_meeting[ctx.meeting.meeting_id]]


def run(meetings, candidates, rule=None):
    extractor = Injected(candidates)
    if rule == "revertonly":
        import revertonly
        extractor = revertonly.Gate(extractor, CHAIN)
    elif rule is not None:
        extractor = harness._Gated(extractor, [rule], CHAIN, lm=None)
    pipe = Pipeline(REGISTRY, extractor, make_policy("immediate"))
    for m in meetings:
        pipe.ingest(m)
    return pipe


def outcome(pipe, slot):
    pieces = pipe.ledger.timeline(*slot)
    values = [p.value for p in pieces]
    current = pipe.ledger.as_of(*slot, valid_at=NOW)
    return {"values": values, "changes": sum(1 for a, b in zip(values, values[1:]) if not values_equal(a, b)),
            "current": current.value if current else None}


PRIOR_BUDGET = meeting("m0", "09-01", [(30, "raj", "The pilot budget is 250,000 ringgit.")])
PRIOR_VENDOR = meeting("m0", "09-01", [(30, "aisha", "We go with Alpha as the pilot vendor.")])


class TwoRealChangesInOneMeeting(unittest.TestCase):
    """Fixture 1: two explicit, approved changes of the same item at different times of one meeting."""
    m1 = meeting("m1", "09-15", [
        (60, "raj", "We approve raising the pilot budget to 280,000 ringgit."),
        (900, "aisha", "Next item: training dates."),
        (1800, "raj", "After the vendor quote, we approve a further increase of the pilot budget to 300,000 ringgit."),
    ])
    candidates = {"m0": [("budget", "amount", 250000, "The pilot budget is 250,000 ringgit.", 0)],
                  "m1": [("budget", "amount", 280000, "We approve raising the pilot budget to 280,000 ringgit.", 0),
                         ("budget", "amount", 300000, "a further increase of the pilot budget to 300,000 ringgit.", 2)]}
    expected = {"values": [250000, 280000, 300000], "changes": 2, "current": 300000}

    def test_shipped_keeps_both_changes(self):
        self.assertEqual(outcome(run([PRIOR_BUDGET, self.m1], self.candidates), ("budget", "amount")), self.expected)

    def test_candidate_a(self):
        got = outcome(run([PRIOR_BUDGET, self.m1], self.candidates, "modevalue"), ("budget", "amount"))
        RESULTS["fixture 1, A"] = got
        self.assertEqual(got, self.expected)

    test_candidate_a = unittest.expectedFailure(test_candidate_a)  # A violates this contract (documented, not softened)

    def test_revertonly(self):
        got = RESULTS["fixture 1, revertonly"] = outcome(run([PRIOR_BUDGET, self.m1], self.candidates, "revertonly"), ("budget", "amount"))
        self.assertEqual(got, self.expected)


class RecapsThenOneFinalDecision(unittest.TestCase):
    """Fixture 2: the old value restated several times as recap, then one clear superseding decision."""
    m1 = meeting("m1", "09-15", [
        (60, "aisha", "As agreed last time, the vendor is Alpha."),
        (400, "raj", "Right, Alpha is the vendor on the current contract."),
        (800, "aisha", "So for now we stay with Alpha."),
        (1500, "raj", "Their security review failed."),
        (1700, "aisha", "Decision: we switch the pilot vendor to Beta, effective today."),
    ])
    candidates = {"m0": [("vendor", "outcome", "Alpha", "We go with Alpha as the pilot vendor.", 0)],
                  "m1": [("vendor", "outcome", "Alpha", "As agreed last time, the vendor is Alpha.", 0),
                         ("vendor", "outcome", "Alpha", "Alpha is the vendor on the current contract.", 1),
                         ("vendor", "outcome", "Alpha", "So for now we stay with Alpha.", 2),
                         ("vendor", "outcome", "Beta", "we switch the pilot vendor to Beta, effective today.", 4)]}
    expected = {"current": "Beta", "changes": 1}

    def test_shipped_takes_the_final_decision(self):
        got = outcome(run([PRIOR_VENDOR, self.m1], self.candidates), ("vendor", "outcome"))
        self.assertEqual({k: got[k] for k in self.expected}, self.expected)

    def test_candidate_a(self):
        got = outcome(run([PRIOR_VENDOR, self.m1], self.candidates, "modevalue"), ("vendor", "outcome"))
        RESULTS["fixture 2, A"] = got
        self.assertEqual({k: got[k] for k in self.expected}, self.expected)

    test_candidate_a = unittest.expectedFailure(test_candidate_a)  # A violates this contract (documented, not softened)

    def test_revertonly(self):
        got = RESULTS["fixture 2, revertonly"] = outcome(run([PRIOR_VENDOR, self.m1], self.candidates, "revertonly"), ("vendor", "outcome"))
        self.assertEqual({k: got[k] for k in self.expected}, self.expected)


class RepeatedUnchangedValue(unittest.TestCase):
    """Fixture 3: an unchanged value referred to again and again; no change may be counted."""
    m1 = meeting("m1", "09-15", [(60 + 300 * i, "aisha", f"Reminder {i}: the vendor is still Alpha.") for i in range(4)])
    candidates = {"m0": [("vendor", "outcome", "Alpha", "We go with Alpha as the pilot vendor.", 0)],
                  "m1": [("vendor", "outcome", "Alpha", f"Reminder {i}: the vendor is still Alpha.", i) for i in range(4)]}
    expected = {"current": "Alpha", "changes": 0}

    def test_shipped(self):
        got = outcome(run([PRIOR_VENDOR, self.m1], self.candidates), ("vendor", "outcome"))
        self.assertEqual({k: got[k] for k in self.expected}, self.expected)

    def test_candidate_a(self):
        got = outcome(run([PRIOR_VENDOR, self.m1], self.candidates, "modevalue"), ("vendor", "outcome"))
        RESULTS["fixture 3, A"] = got
        self.assertEqual({k: got[k] for k in self.expected}, self.expected)

    def test_revertonly(self):
        got = RESULTS["fixture 3, revertonly"] = outcome(run([PRIOR_VENDOR, self.m1], self.candidates, "revertonly"), ("vendor", "outcome"))
        self.assertEqual({k: got[k] for k in self.expected}, self.expected)


RESULTS = {}

if __name__ == "__main__":
    import json
    unittest.main(exit=False, verbosity=2)
    print(json.dumps(RESULTS, indent=1))
