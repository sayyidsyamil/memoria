import json
import unittest

from helpers import Env
from memoria_engine import AliasConflict, AlreadyDone, InvalidAssertion, StaleProposal, UnknownReference


class TestProposals(unittest.TestCase):
    def setUp(self):
        self.E = Env()
        self.E.clock.t = 1000
        self.a = self.E.say("dec1", "outcome", "Vendor A", 100)
        self.E.clock.t = 2000

    def propose(self, value, at, **kw):
        return self.E.L.propose("dec1", "outcome", value, self.E.ev(at),
                                confidence=0.62, reason="a later meeting disagrees", **kw)

    def test_a_proposal_changes_nothing_until_it_is_accepted(self):
        E = self.E
        pid = self.propose("Vendor B", 200)
        self.assertEqual(E.values("dec1", "outcome", [250]), ["Vendor A"])
        pending = E.L.pending_proposals()
        self.assertEqual([p["proposal_id"] for p in pending], [pid])
        self.assertEqual((pending[0]["base_fact_id"], pending[0]["confidence"]), (self.a.fact_id, 0.62))
        out = E.L.accept(pid, "najib")
        self.assertEqual((out.status, out.supersedes_fact_id), ("in_force", self.a.fact_id))
        self.assertEqual(E.values("dec1", "outcome", [250]), ["Vendor B"])
        self.assertEqual(E.L.pending_proposals(), [])
        self.assertEqual(E.L.check_invariants(), [])

    def test_accepting_with_edits_records_the_edit_and_keeps_the_original_proposal(self):
        E = self.E
        pid = self.propose("Vendor B", 200)
        out = E.L.accept(pid, "najib", edits={"value": "Vendor C"}, note="they said C")
        self.assertEqual(E.values("dec1", "outcome", [250]), ["Vendor C"])
        review = E.L._db.execute("SELECT outcome, resulting_fact_id, note FROM reviews").fetchone()
        self.assertEqual(tuple(review), ("accepted_edited", out.fact_id, "they said C"))
        payload = E.L._db.execute("SELECT payload_json FROM proposals").fetchone()[0]
        self.assertEqual(json.loads(payload)["value"], "Vendor B")

    def test_an_edit_that_changes_nothing_counts_as_unedited(self):
        pid = self.propose("Vendor B", 200)
        self.E.L.accept(pid, "najib", edits={"value": "Vendor B"})
        self.assertEqual(self.E.L.review_stats()["accepted"], 1)

    def test_rejecting_leaves_beliefs_untouched(self):
        E = self.E
        before = E.L.dump()["validity"]
        pid = self.propose("Vendor B", 200)
        E.L.reject(pid, "najib", note="that was a hypothetical")
        self.assertEqual(E.L.dump()["validity"], before)
        self.assertEqual(E.L.review_stats()["rejected"], 1)

    def test_a_proposal_goes_stale_if_the_belief_it_was_based_on_changed(self):
        E = self.E
        pid = self.propose("Vendor B", 200)
        E.say("dec1", "outcome", "Vendor C", 150)  # someone else's decision supersedes A first
        with self.assertRaises(StaleProposal):
            E.L.accept(pid, "najib")
        self.assertEqual([p["proposal_id"] for p in E.L.pending_proposals()], [pid])
        self.assertEqual(E.L.review_stats()["reviewed"], 0)

    def test_a_proposal_can_only_be_reviewed_once(self):
        E = self.E
        pid = self.propose("Vendor B", 200)
        E.L.accept(pid, "najib")
        with self.assertRaises(AlreadyDone):
            E.L.accept(pid, "najib")
        with self.assertRaises(AlreadyDone):
            E.L.reject(pid, "najib")
        with self.assertRaises(UnknownReference):
            E.L.accept(999, "najib")
        with self.assertRaises(InvalidAssertion):
            E.L.accept(self.propose("Vendor D", 300), "")

    def test_review_statistics(self):
        E = self.E
        p1 = E.L.propose("c1", "deadline", "2026-03-01", E.ev(100))
        p2 = E.L.propose("c2", "deadline", "2026-04-01", E.ev(100))
        p3 = E.L.propose("dec2", "outcome", "go", E.ev(100))
        E.L.propose("c1", "status", "open", E.ev(100))
        E.L.accept(p1, "najib")
        E.L.accept(p2, "najib", edits={"value": "2026-04-15"})
        E.L.reject(p3, "najib")
        stats = E.L.review_stats()
        self.assertEqual((stats["pending"], stats["reviewed"], stats["accepted"], stats["accepted_edited"], stats["rejected"]),
                         (1, 3, 1, 1, 1))
        self.assertAlmostEqual(stats["acceptance_rate"], 1 / 3)
        self.assertAlmostEqual(stats["acceptance_rate_incl_edits"], 2 / 3)

    def test_no_reviews_means_no_rate(self):
        self.assertIsNone(self.E.L.review_stats()["acceptance_rate"])


class TestAliases(unittest.TestCase):
    def setUp(self):
        self.E = Env()
        self.E.L.add_entity("project_alpha", "project", "Project Alpha")
        self.E.L.add_entity("project_beta", "project", "Project Beta")

    def test_aliases_in_either_language_resolve_to_one_entity(self):
        L = self.E.L
        for alias, lang in (("Projek Alpha", "ms"), ("the Alpha project", "en"), ("Alpha", None)):
            L.add_alias(alias, "project_alpha", lang=lang)
        for text in ("projek alpha", "  THE alpha  Project ", "Alpha.", "ALPHA"):
            self.assertEqual(L.resolve_alias(text), "project_alpha", text)
        self.assertIsNone(L.resolve_alias("Beta"))

    def test_an_ambiguous_alias_is_refused(self):
        L = self.E.L
        L.add_alias("Alpha", "project_alpha")
        self.assertEqual(L.add_alias("alpha", "project_alpha"), "alpha")  # idempotent
        with self.assertRaises(AliasConflict):
            L.add_alias("ALPHA", "project_beta")

    def test_bad_input(self):
        L = self.E.L
        with self.assertRaises(UnknownReference):
            L.add_alias("Gamma", "no_such_entity")
        with self.assertRaises(InvalidAssertion):
            L.add_alias("  ..  ", "project_alpha")
        with self.assertRaises(InvalidAssertion):
            L.add_entity("project_alpha", "project", "A different name")


class TestClock(unittest.TestCase):
    def test_transaction_time_strictly_increases_with_a_frozen_or_backwards_clock(self):
        E = Env()
        E.clock.t = 5000
        txs = [E.say("dec1", "outcome", v, at).tx for v, at in (("A", 100), ("B", 200), ("C", 300))]
        self.assertEqual(txs, sorted(set(txs)))
        E.clock.t = 1
        self.assertGreater(E.say("dec1", "outcome", "D", 400).tx, txs[-1])


if __name__ == "__main__":
    unittest.main()
