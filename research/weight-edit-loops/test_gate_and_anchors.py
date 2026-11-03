import json
import unittest
from unittest.mock import patch

from activation_gate import output_phase_sampler
from anchors import hits
from context import HERE, assert_frozen_sources, prompt_rows, read_jsonl
from quality import event_quality
from stop_rule import conservative


class GatePhaseTests(unittest.TestCase):
    def test_baseline_guard_checks_real_sources_and_refuses_a_mismatch(self):
        self.assertEqual(len(assert_frozen_sources()), 5)
        with patch("context.sha256", return_value="mismatch"):
            with self.assertRaises(RuntimeError):
                assert_frozen_sources()

    def test_enable_follows_first_prediction_and_reset_starts_fresh(self):
        class Controller:
            active = False
            def reset(self):
                self.active = False
            def enable(self):
                self.active = True
        controller, observed = Controller(), []
        def sampler(value):
            observed.append(controller.active)
            return value
        wrapped = output_phase_sampler(sampler, controller)
        self.assertEqual(wrapped(7), 7)
        self.assertEqual(wrapped(9), 9)
        controller.reset()
        self.assertEqual(wrapped(4), 4)
        self.assertEqual(observed, [False, True, False])


class LaterEventTests(unittest.TestCase):
    def test_unresolved_burst_can_discard_a_real_source_grounded_later_event(self):
        row = next(r for r in prompt_rows() if r["id"] == "TS3006b.w1")
        a, b = json.loads(row["reference"]["text"])["events"][:2]
        text = json.dumps({"events": [{**a, "unresolved": True}] * 4 + [b]})
        detector = conservative()
        self.assertTrue(detector.feed(text))
        self.assertEqual(len(event_quality(row, text)["unique_valid"]), 1)
        self.assertEqual(len(event_quality(row, detector.closed_text())["unique_valid"]), 0)

    def test_gold_sparse_tail_still_has_three_correct_preservation_anchors(self):
        row = next(r for r in prompt_rows() if r["id"] == "TS3006d.w3")
        baseline = next(r for r in read_jsonl(HERE / "results" / "baseline-r1.jsonl") if r["id"] == row["id"])
        self.assertEqual(baseline["quality"]["gold_hits"], [])
        self.assertEqual(len(hits(row["id"], baseline["quality"])), 3)
        # A shorter response can preserve all sparse gold matches (zero) while
        # discarding an explicit, grounded late confirmation.
        cut = baseline["text"].index('{"turn":367')
        shorter = event_quality(row, baseline["text"][:cut])
        self.assertEqual(shorter["gold_hits"], [])
        self.assertEqual(len(hits(row["id"], shorter)), 2)
        self.assertNotIn("late-single-curve-confirmation", hits(row["id"], shorter))


if __name__ == "__main__":
    unittest.main()
