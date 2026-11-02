import unittest

from helpers import Env
from memoria_engine import AlreadyDone, Evidence, InvalidAssertion, UnknownReference


class TestSupersession(unittest.TestCase):
    def setUp(self):
        self.E = Env()

    def rows(self):
        return [tuple(r) for r in self.E.L._db.execute(
            "SELECT fact_id, valid_from, valid_to, tx_start, tx_end FROM validity ORDER BY validity_id")]

    def test_three_writes_and_time_travel(self):
        E = self.E
        E.clock.t = 1000
        a = E.say("dec1", "outcome", "Vendor A", 100)
        E.clock.t = 2000
        b = E.say("dec1", "outcome", "Vendor B", 200)
        self.assertEqual((b.status, b.supersedes_fact_id), ("in_force", a.fact_id))
        self.assertEqual(self.rows(), [
            (a.fact_id, 100, None, a.tx, b.tx),  # the old belief "A forever" stops being held
            (a.fact_id, 100, 200, b.tx, None),  # re-recorded: A held until B took over
            (b.fact_id, 200, None, b.tx, None),
        ])
        self.assertEqual(E.values("dec1", "outcome", [50, 150, 250]), [None, "Vendor A", "Vendor B"])
        self.assertEqual(E.values("dec1", "outcome", [50, 150, 250], tx_at=1500), [None, "Vendor A", "Vendor A"])
        self.assertEqual(E.L.as_of("dec1", "outcome", valid_at=150).valid_to, 200)
        self.assertEqual(E.L.current("dec1", "outcome").value, "Vendor B")
        self.assertEqual(E.L.check_invariants(), [])

    def test_kind_hint_is_recorded_only_when_something_is_superseded(self):
        E = self.E
        first = E.say("dec1", "outcome", "go", 100, kind_hint="REVERSE")
        second = E.say("dec1", "outcome", "no-go", 200, kind_hint="REVERSE")
        types = {h["fact_id"]: h["change_type"] for h in E.L.history("dec1", "outcome")}
        self.assertEqual(types, {first.fact_id: "INITIAL", second.fact_id: "REVERSE"})

    def test_lifecycle_hints_apply_even_without_an_earlier_belief(self):
        E = self.E
        done = E.say("c1", "status", "done", 100, kind_hint="COMPLETE")
        other = E.say("c2", "status", "cancelled", 100, kind_hint="REVERSE")
        types = {h["fact_id"]: h["change_type"] for o in ("c1", "c2") for h in E.L.history(o, "status")}
        self.assertEqual(types, {done.fact_id: "COMPLETE", other.fact_id: "INITIAL"})

    def test_same_valid_from_replaces_without_a_closed_copy(self):
        E = self.E
        E.clock.t = 1000
        a = E.say("dec1", "outcome", "A", 100)
        E.clock.t = 2000
        b = E.say("dec1", "outcome", "B", 100)  # same decision time: later ingestion wins
        self.assertEqual(b.supersedes_fact_id, a.fact_id)
        self.assertEqual(self.rows(), [(a.fact_id, 100, None, a.tx, b.tx), (b.fact_id, 100, None, b.tx, None)])


class TestOrdering(unittest.TestCase):
    def setUp(self):
        self.E = Env()

    def pieces(self):
        return [(t.fact_id, t.valid_from, t.valid_to) for t in self.E.L.timeline("dec1", "outcome")]

    def test_older_decision_ingested_late_does_not_override_newer(self):
        E = self.E
        b = E.say("dec1", "outcome", "B", 200)
        a = E.say("dec1", "outcome", "A", 100)
        self.assertEqual((a.status, a.supersedes_fact_id), ("in_force", None))
        self.assertEqual(E.values("dec1", "outcome", [50, 150, 250]), [None, "A", "B"])
        self.assertEqual(self.pieces(), [(a.fact_id, 100, 200), (b.fact_id, 200, None)])

    def test_fully_overridden_older_claim_is_recorded_but_not_in_force(self):
        E = self.E
        b = E.say("dec1", "outcome", "B", 200, valid_from=100)  # decided later, effective retroactively
        a = E.say("dec1", "outcome", "A", 150, valid_from=120)
        self.assertEqual(a.status, "not_in_force")
        self.assertEqual(self.pieces(), [(b.fact_id, 100, None)])
        self.assertEqual(len(E.L.history("dec1", "outcome")), 2)

    def test_later_decision_with_an_earlier_effective_date_overrides(self):
        E = self.E
        E.say("dec1", "outcome", "A", 100, valid_from=300)
        E.say("dec1", "outcome", "B", 200, valid_from=150)
        self.assertEqual(E.values("dec1", "outcome", [100, 200, 400]), [None, "B", "B"])

    def test_windowed_claim_reverts_to_the_earlier_value(self):
        E = self.E
        E.say("dec1", "outcome", "5M", 100)
        E.say("dec1", "outcome", "6M", 200, valid_to=300)
        self.assertEqual(E.values("dec1", "outcome", [150, 250, 350]), ["5M", "6M", "5M"])
        self.assertEqual(len(E.L.timeline("dec1", "outcome")), 3)
        self.assertEqual(E.L.check_invariants(), [])

    def test_default_valid_from_uses_meeting_time_plus_audio_offset(self):
        E = self.E
        src = E.L.add_source("chunk-x", "m1", 1_000_000)
        E.L.assert_fact("dec1", "outcome", "A", Evidence(src, "ok", audio_start=2.5))
        r = E.L.assert_fact("dec1", "outcome", "B", Evidence(src, "ok", audio_start=2.5), valid_from=9_000_000)
        history = {h["fact_id"]: h for h in E.L.history("dec1", "outcome")}
        first = min(history)
        self.assertEqual((history[first]["decided_at"], history[first]["claim_from"], history[first]["claim_from_basis"]),
                         (3_500_000, 3_500_000, "meeting_time"))
        self.assertEqual((history[r.fact_id]["claim_from"], history[r.fact_id]["claim_from_basis"]), (9_000_000, "stated"))


class TestReconfirm(unittest.TestCase):
    def setUp(self):
        self.E = Env()

    def test_reconfirmation_adds_evidence_but_no_belief_churn(self):
        E = self.E
        a = E.say("dec1", "outcome", "5M", 100)
        before = E.L.dump()["validity"]
        n = E.say("dec1", "outcome", "5M", 300, ev={"span": "as agreed last time"})
        self.assertEqual((n.status, n.confirms_fact_id, n.supersedes_fact_id), ("reconfirmed", a.fact_id, None))
        self.assertEqual(E.L.dump()["validity"], before)
        history = {h["fact_id"]: h for h in E.L.history("dec1", "outcome")}
        self.assertEqual(history[n.fact_id]["change_type"], "CONFIRM")
        self.assertEqual(history[n.fact_id]["evidence"][0]["span_text"], "as agreed last time")

    def test_retracting_the_original_lets_the_reconfirmation_take_over(self):
        E = self.E
        E.clock.t = 1000
        a = E.say("dec1", "outcome", "5M", 100)
        E.clock.t = 2000
        n = E.say("dec1", "outcome", "5M", 300)
        E.clock.t = 3000
        E.L.retract(a.fact_id, "ana", "wrong meeting")
        self.assertEqual(E.values("dec1", "outcome", [200, 400]), [None, "5M"])
        self.assertEqual(E.values("dec1", "outcome", [200, 400], tx_at=2500), ["5M", "5M"])
        self.assertEqual(E.L.timeline("dec1", "outcome")[0].fact_id, n.fact_id)

    def test_returning_to_an_earlier_value_after_a_change_is_a_reversal(self):
        E = self.E
        a = E.say("dec1", "outcome", "5M", 100)
        b = E.say("dec1", "outcome", "6M", 200)
        n = E.say("dec1", "outcome", "5M", 300)
        self.assertEqual((n.status, n.supersedes_fact_id, n.confirms_fact_id), ("in_force", b.fact_id, None))
        self.assertEqual([(t.fact_id, t.valid_from, t.valid_to) for t in E.L.timeline("dec1", "outcome")],
                         [(a.fact_id, 100, 200), (b.fact_id, 200, 300), (n.fact_id, 300, None)])


class TestCorrectAndRetract(unittest.TestCase):
    def setUp(self):
        self.E = Env()
        self.E.clock.t = 1000
        self.a = self.E.say("dec1", "outcome", "Vendor A", 100)
        self.E.clock.t = 2000
        self.b = self.E.say("dec1", "outcome", "Vendor B", 200)
        self.E.clock.t = 3000

    def test_correction_changes_the_belief_but_not_what_we_believed_before(self):
        E = self.E
        c = E.L.correct(self.b.fact_id, "ana", "ASR heard B, they said C", value="Vendor C")
        self.assertEqual((c.status, c.supersedes_fact_id), ("in_force", self.a.fact_id))
        self.assertEqual(E.values("dec1", "outcome", [150, 250]), ["Vendor A", "Vendor C"])
        self.assertEqual(E.values("dec1", "outcome", [150, 250], tx_at=2500), ["Vendor A", "Vendor B"])
        history = {h["fact_id"]: h for h in E.L.history("dec1", "outcome")}
        self.assertEqual(history[c.fact_id]["corrects_fact_id"], self.b.fact_id)
        self.assertEqual(history[c.fact_id]["change_type"], "CORRECT")
        self.assertEqual(history[c.fact_id]["decided_at"], history[self.b.fact_id]["decided_at"])
        self.assertTrue(history[self.b.fact_id]["retracted"]["reason"].startswith("corrected:"))
        self.assertEqual(history[c.fact_id]["evidence"], history[self.b.fact_id]["evidence"])
        self.assertEqual(E.L.check_invariants(), [])

    def test_correction_can_move_valid_time(self):
        E = self.E
        c = E.L.correct(self.b.fact_id, "ana", "effective date misheard", valid_from=250)
        self.assertEqual([(t.fact_id, t.valid_from, t.valid_to) for t in E.L.timeline("dec1", "outcome")],
                         [(self.a.fact_id, 100, 250), (c.fact_id, 250, None)])
        self.assertEqual([h["claim_from_basis"] for h in E.L.history("dec1", "outcome") if h["fact_id"] == c.fact_id], ["stated"])

    def test_correction_with_new_evidence_replaces_the_evidence(self):
        E = self.E
        c = E.L.correct(self.b.fact_id, "ana", "better span", value="Vendor C", evidence=E.ev(200, span="we choose C"))
        spans = [e["span_text"] for h in E.L.history("dec1", "outcome") if h["fact_id"] == c.fact_id for e in h["evidence"]]
        self.assertEqual(spans, ["we choose C"])

    def test_correction_keeps_the_original_decision_time_even_with_later_evidence(self):
        E = self.E
        c = E.say("dec1", "outcome", "Vendor C", 300)  # decided after B, so it wins from 300
        fixed = E.L.correct(self.b.fact_id, "ana", "re-listened", value="Vendor B2", evidence=E.ev(500, span="B2"))
        history = {h["fact_id"]: h for h in E.L.history("dec1", "outcome")}
        self.assertEqual(history[fixed.fact_id]["decided_at"], history[self.b.fact_id]["decided_at"])
        self.assertEqual(E.values("dec1", "outcome", [250, 350]), ["Vendor B2", "Vendor C"])
        self.assertEqual(c.status, "in_force")

    def test_correction_keeps_its_place_in_a_same_time_tie(self):
        E = self.E
        first = E.say("dec2", "outcome", "x", 100)
        second = E.say("dec2", "outcome", "y", 100)  # same decision time, ingested later: wins
        E.L.correct(first.fact_id, "ana", "typo", value="z")
        self.assertEqual(E.L.current("dec2", "outcome").value, "y")
        self.assertEqual(E.L.current("dec2", "outcome").fact_id, second.fact_id)

    def test_retract_restores_the_earlier_decision(self):
        E = self.E
        E.L.retract(self.b.fact_id, "ana", "false supersession")
        self.assertEqual([(t.fact_id, t.valid_from, t.valid_to) for t in E.L.timeline("dec1", "outcome")],
                         [(self.a.fact_id, 100, None)])
        self.assertEqual(E.values("dec1", "outcome", [250], tx_at=2500), ["Vendor B"])
        self.assertEqual(E.L.check_invariants(), [])

    def test_errors(self):
        E = self.E
        E.L.retract(self.b.fact_id, "ana", "wrong")
        with self.assertRaises(AlreadyDone):
            E.L.retract(self.b.fact_id, "ana", "again")
        with self.assertRaises(AlreadyDone):
            E.L.correct(self.b.fact_id, "ana", "too late", value="X")
        with self.assertRaises(UnknownReference):
            E.L.retract(999, "ana", "no such fact")
        with self.assertRaises(InvalidAssertion):
            E.L.retract(self.a.fact_id, "", "no reviewer")
        with self.assertRaises(InvalidAssertion):
            E.L.retract(self.a.fact_id, "ana", "  ")


class TestSlots(unittest.TestCase):
    def setUp(self):
        self.E = Env()

    def test_commitments_are_separate_objects_and_do_not_collide(self):
        E = self.E
        E.say("c1", "deadline", "2026-03-01", 100)
        E.say("c2", "deadline", "2026-04-01", 100)
        E.say("c1", "deadline", "2026-05-01", 200)
        self.assertEqual(E.L.current("c1", "deadline").value, "2026-05-01")
        self.assertEqual(E.L.current("c2", "deadline").value, "2026-04-01")

    def test_multi_valued_attributes_use_a_discriminator_per_member(self):
        E = self.E
        E.say("issue1", "participants", "present", 100, discriminator="ali")
        E.say("issue1", "participants", "present", 100, discriminator="siti")
        E.say("issue1", "participants", "left early", 200, discriminator="ali")
        self.assertEqual(E.L.current("issue1", "participants", discriminator="ali").value, "left early")
        self.assertEqual(E.L.current("issue1", "participants", discriminator="siti").value, "present")

    def test_validation(self):
        E = self.E
        ev = E.ev(100)
        cases = [
            (InvalidAssertion, lambda: E.L.assert_fact("dec1", "outcome", "x", ev, discriminator="d")),
            (InvalidAssertion, lambda: E.L.assert_fact("issue1", "participants", "x", ev)),
            (UnknownReference, lambda: E.L.assert_fact("dec1", "no_such_attribute", "x", ev)),
            (UnknownReference, lambda: E.L.assert_fact("no_such_object", "outcome", "x", ev)),
            (UnknownReference, lambda: E.L.assert_fact("dec1", "outcome", "x", Evidence("0" * 64, "span"))),
            (InvalidAssertion, lambda: E.L.assert_fact("dec1", "outcome", "x", [])),
            (InvalidAssertion, lambda: E.L.assert_fact("dec1", "outcome", "x", Evidence(ev.source_id, "  "))),
            (InvalidAssertion, lambda: E.L.assert_fact("dec1", "outcome", "x", ev, valid_from=200, valid_to=200)),
            (InvalidAssertion, lambda: E.L.assert_fact("dec1", "outcome", float("nan"), ev)),
            (InvalidAssertion, lambda: E.L.assert_fact("dec1", "outcome", {1, 2}, ev)),
            (InvalidAssertion, lambda: E.L.assert_fact("dec1", "outcome", "x", ev, kind_hint="MAYBE")),
        ]
        for error, call in cases:
            with self.subTest(error=error.__name__):
                with self.assertRaises(error):
                    call()

    def test_a_failed_write_leaves_no_trace(self):
        E = self.E
        ev = E.ev(100)
        before = E.L.dump()
        with self.assertRaises(InvalidAssertion):
            E.L.assert_fact("dec1", "outcome", float("nan"), ev)
        self.assertEqual(E.L.dump(), before)

    def test_equal_values_compare_equal_whatever_their_spelling(self):
        E = self.E
        a = E.say("c1", "amount", {"currency": "MYR", "amount": 5000000}, 100)
        n = E.say("c1", "amount", {"amount": 5000000.0, "currency": "MYR"}, 200)
        self.assertEqual((n.status, n.confirms_fact_id), ("reconfirmed", a.fact_id))


if __name__ == "__main__":
    unittest.main()
