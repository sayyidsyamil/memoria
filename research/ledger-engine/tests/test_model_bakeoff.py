"""Model promotion must be based on task outcomes, with exact pairing."""
import copy
import unittest

from scripts.model_bakeoff import MODELS, promote_check


def result(overall=0.8, current=0.7, precision=0.4, recall=0.7):
    return {"memoria": {"rows": [{"chain": "team", "qid": "q1", "gold": "yes"}],
                        "qa": {"ext+router": {"overall": {"accuracy": overall}, "current": {"accuracy": current}}},
                        "extraction": {"precision": precision, "recall": recall}}}


class ModelBakeoffTests(unittest.TestCase):
    def test_equal_or_worse_qa_cannot_promote(self):
        self.assertFalse(promote_check(result(), result())["eligible_for_test"])
        self.assertFalse(promote_check(result(overall=0.7), result())["eligible_for_test"])

    def test_pooled_gain_cannot_hide_precision_or_current_regression(self):
        for kwargs in ({"precision": 0.3}, {"recall": 0.6}, {"current": 0.6}):
            self.assertFalse(promote_check(result(overall=0.9, **kwargs), result())["eligible_for_test"])

    def test_better_candidate_never_automatically_replaces_default(self):
        gate = promote_check(result(overall=0.9), result())
        self.assertTrue(gate["eligible_for_test"])
        self.assertFalse(gate["automatic_default_switch"])

    def test_mismatched_gold_or_questions_rejected(self):
        for key in ("gold", "qid", "chain"):
            candidate = result()
            candidate["memoria"]["rows"][0][key] = "different"
            with self.assertRaises(ValueError):
                promote_check(candidate, result())

    def test_candidate_checkpoint_is_revision_pinned(self):
        self.assertEqual(MODELS["minicpm5"]["repo"], "openbmb/MiniCPM5-2B-MLX")
        self.assertEqual(len(MODELS["minicpm5"]["revision"]), 40)


if __name__ == "__main__":
    unittest.main()
