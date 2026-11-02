"""A number-valued candidate whose number is not in its own quote is a likely misreading (found when the demo series gave 2,500,000 for
"250,000 ringgit"): under a review policy it waits in the inbox instead of being applied. The 'apply at once' policy is unchanged."""
import unittest

from memoria_engine.pipeline import (AttributeSpec, Candidate, Meeting, ObjectSpec, Pipeline, Registry, Turn, make_policy, number_not_in_quote, numbers_in)


def registry():
    return Registry({
        "budget": ObjectSpec("budget", "decision", "Budget", (AttributeSpec("amount", "number"),)),
        "golive": ObjectSpec("golive", "decision", "Go-live", (AttributeSpec("date", "date"),)),
        "vendor": ObjectSpec("vendor", "decision", "Vendor", (AttributeSpec("outcome", "enum", ("Alpha", "Beta")),)),
    }, {})


class Fixed:
    name = "fixed"

    def __init__(self, candidates):
        self.candidates, self.last_stats = candidates, {}

    def extract(self, ctx):
        return self.candidates


def ingest(policy, text, candidate):
    meeting = Meeting("m1", 1_700_000_000_000_000, 1_700_000_100_000_000, (Turn(0, "chair", 0.0, "Let us start."), Turn(1, "chair", 5.0, text)))
    pipe = Pipeline(registry(), Fixed([candidate]), make_policy(policy))
    result = pipe.ingest(meeting)
    return pipe, result.dispositions[0]


class NumbersTest(unittest.TestCase):
    def test_numbers_in_reads_separators_decimals_and_magnitude_words(self):
        self.assertIn(250000.0, numbers_in("the pilot budget is 250,000 ringgit"))
        self.assertIn(12.5, numbers_in("twelve and a half? no: 12.5 euros"))
        found = numbers_in("cap it at RM2 million, or 250k")
        for expected in (2.0, 2_000_000.0, 250.0, 250_000.0):
            self.assertIn(expected, found)
        self.assertEqual(numbers_in("no digits here, only twelve fifty"), [])

    def test_the_turn_prefix_and_dates_do_not_count_as_amounts_by_accident(self):
        self.assertFalse(number_not_in_quote(250000, "250,000 on 1 March"))

    def test_match_and_mismatch(self):
        self.assertFalse(number_not_in_quote(250000, "the budget is 250,000 ringgit"))
        self.assertTrue(number_not_in_quote(2500000, "the budget is 250,000 ringgit"))
        self.assertFalse(number_not_in_quote(2000000, "RM2 million"))
        self.assertFalse(number_not_in_quote(12.5, "it costs 12.5 euros"))

    def test_no_digits_means_it_cannot_be_judged(self):
        self.assertFalse(number_not_in_quote(280000, "Good, so no change to the budget."))
        self.assertFalse(number_not_in_quote(12.5, "twelve fifty euros"))

    def test_only_numbers_are_checked(self):
        self.assertFalse(number_not_in_quote("Beta", "we pick Beta"))
        self.assertFalse(number_not_in_quote(True, "yes 5"))


class PolicyTest(unittest.TestCase):
    TEXT = "Okay, the pilot budget is 250,000 ringgit. Raj, please note that down."

    def test_a_misread_number_waits_for_review_under_the_default_policy(self):
        pipe, d = ingest("confirm_conflicts", self.TEXT, Candidate("budget", "amount", 2500000, "the pilot budget is 250,000 ringgit", 1, None, 0.9))
        self.assertEqual(d.status, "proposed")
        self.assertIsNone(pipe.ledger.current("budget", "amount"), "nothing is recorded until a person decides")
        proposal = pipe.ledger.pending_proposals()[0]
        self.assertEqual(proposal["reason"], "the number is not in the quote")

    def test_a_matching_number_is_applied_as_before(self):
        pipe, d = ingest("confirm_conflicts", self.TEXT, Candidate("budget", "amount", 250000, "the pilot budget is 250,000 ringgit", 1, None, 0.9))
        self.assertEqual(d.status, "applied")
        self.assertEqual(pipe.ledger.current("budget", "amount").value, 250000)

    def test_apply_at_once_is_unchanged(self):
        pipe, d = ingest("immediate", self.TEXT, Candidate("budget", "amount", 2500000, "the pilot budget is 250,000 ringgit", 1, None, 0.9))
        self.assertEqual(d.status, "applied")

    def test_a_person_can_edit_and_accept_the_suggestion(self):
        pipe, d = ingest("confirm_conflicts", self.TEXT, Candidate("budget", "amount", 2500000, "the pilot budget is 250,000 ringgit", 1, None, 0.9))
        pipe.ledger.accept(d.proposal_id, "Aisha", edits={"value": 250000})
        self.assertEqual(pipe.ledger.current("budget", "amount").value, 250000)

    def test_other_types_are_not_affected(self):
        pipe, d = ingest("confirm_conflicts", "Then let's fix it for 26 October 2026, Beta.", Candidate("golive", "date", "2026-10-26", "fix it for 26 October 2026", 1, None, 0.9))
        self.assertEqual(d.status, "applied")
        pipe, d = ingest("confirm_conflicts", "We go with Beta.", Candidate("vendor", "outcome", "Beta", "We go with Beta", 1, None, 0.9))
        self.assertEqual(d.status, "applied")

    def test_with_several_numbers_in_the_turn_any_match_is_enough(self):
        text = "The licence is 30,000 ringgit higher, so the budget goes from 250,000 to 280,000 ringgit."
        _, ok = ingest("confirm_conflicts", text, Candidate("budget", "amount", 280000, "the budget goes from 250,000 to 280,000 ringgit", 1, None, 0.9))
        self.assertEqual(ok.status, "applied")
        _, bad = ingest("confirm_conflicts", text, Candidate("budget", "amount", 2800000, "the budget goes from 250,000 to 280,000 ringgit", 1, None, 0.9))
        self.assertEqual(bad.status, "proposed")


if __name__ == "__main__":
    unittest.main()
