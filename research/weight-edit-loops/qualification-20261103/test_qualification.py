"""Regression checks for the zero-valid-event and random-control qualification traps."""
import copy
import json
import unittest

from qual_common import HERE, frozen
from qual_checks import decide


class QualificationTests(unittest.TestCase):
    def records(self):
        audit = json.loads((HERE / "frozen.json").read_text())["reference_audit"]
        rows = []
        for condition in ("base-before", "edit", "random", "base-after"):
            edit = condition == "edit"
            current = copy.deepcopy(audit)
            if edit:
                current["strict_raw_schema"] = True
            rows.append({"condition": condition, "matches_historical_bytes": not edit,
                         "hit_budget": not edit, "natural_eos": edit, "early_stopped": False,
                         "raw_text": "same", "text": "same", "output_tokens": 900 if edit else 1800,
                         "seconds": 30 if edit else 60, "audit": current, "baseline_wrong_count": 0,
                         "versus_before": {"lost_gold": [], "lost_unique_valid": [], "lost_source_controls": []}})
        return rows

    def test_frozen_archive_and_exact_existing_strength(self):
        plan = frozen()
        self.assertEqual(plan["edit"]["strength"], 2)
        self.assertEqual(plan["random_control"]["strength"], 2)
        self.assertEqual(len(plan["reference_audit"]["source_control_hits"]), 6)

    def test_empty_output_cannot_pass_zero_valid_baseline(self):
        rows = self.records()
        self.assertTrue(decide(rows)["passed"])
        rows[1]["audit"]["nonempty_events"] = False
        self.assertFalse(decide(rows)["passed"])

    def test_loss_of_source_supported_unresolved_event_fails(self):
        rows = self.records()
        self.assertEqual(rows[0]["audit"]["quality"]["unique_valid"], [])
        rows[1]["versus_before"]["lost_source_controls"] = ["single-curve-t23"]
        self.assertFalse(decide(rows)["passed"])

    def test_equal_random_success_is_not_a_specific_edit_win(self):
        rows = self.records()
        rows[2] = copy.deepcopy(rows[1])
        rows[2]["condition"] = "random"
        self.assertFalse(decide(rows)["passed"])

    def test_restore_mismatch_closes_comparison(self):
        rows = self.records()
        rows[-1]["matches_historical_bytes"] = False
        self.assertFalse(decide(rows)["passed"])

    def test_actual_independent_loss_is_not_hidden_by_clean_eos_and_zero_valid_counts(self):
        rows = [json.loads(line) for line in (HERE / "results" / "transfer.jsonl").read_text().splitlines()]
        edit = next(r for r in rows if r["condition"] == "edit")
        self.assertTrue(edit["natural_eos"] and edit["audit"]["strict_raw_schema"])
        self.assertEqual(edit["output_tokens"], 145)
        self.assertTrue(all(not r["audit"]["quality"]["unique_valid"] for r in rows))
        self.assertEqual(len(edit["versus_before"]["lost_source_controls"]), 4)
        self.assertFalse(decide(rows)["passed"])


if __name__ == "__main__":
    unittest.main()
