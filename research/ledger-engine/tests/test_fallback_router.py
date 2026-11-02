"""The rule-based second chance for questions the model router could not map, and the correction of "as recorded by" misrouting."""
import json
import shutil
import tempfile
import unittest
from datetime import date
from pathlib import Path

from memoria_engine.fallback_router import AS_RECORDED, fallback_route, parse_dates
from memoria_engine.service import Service, handle, registry_from_json

DEMO = Path(__file__).resolve().parent.parent / "data" / "demo" / "registry.json"
TODAY = "2026-10-14"


def registry():
    return registry_from_json(json.loads(DEMO.read_text()))


class DatesTest(unittest.TestCase):
    def test_common_ways_to_write_a_date(self):
        today = date(2026, 10, 14)
        for text in ("on 27 September 2026", "on 27th of September 2026", "on September 27, 2026", "on Sept 27 2026", "on 2026-09-27", "on 27 Sep 2026"):
            self.assertEqual(parse_dates(text, today), [date(2026, 9, 27)], text)

    def test_a_missing_year_means_this_year(self):
        self.assertEqual(parse_dates("budget on 27 September", date(2026, 10, 14)), [date(2026, 9, 27)])

    def test_two_dates_keep_their_order_and_nonsense_is_ignored(self):
        self.assertEqual(parse_dates("recorded by 6 October 2026 for 16 October 2026", date(2026, 10, 14)), [date(2026, 10, 6), date(2026, 10, 16)])
        self.assertEqual(parse_dates("on 31 February 2026", date(2026, 10, 14)), [])
        self.assertEqual(parse_dates("no date here", date(2026, 10, 14)), [])


class RouteTest(unittest.TestCase):
    def route(self, question):
        return fallback_route(registry(), TODAY, question)

    def test_current_value_of_a_single_attribute_item(self):
        r = self.route("Which vendor are we using for the pilot now?")
        self.assertEqual((r.ok, r.type, r.object_id, r.attribute), (True, "current", "vendor", "outcome"))

    def test_the_attribute_is_chosen_from_the_wording(self):
        self.assertEqual(self.route("Who owns the data migration?").attribute, "owner")
        self.assertEqual(self.route("When is staff training due?").attribute, "deadline")
        self.assertEqual(self.route("What is the status of the security review?").attribute, "status")

    def test_how_many_times_is_a_change_count(self):
        for q in ("How many times did the go-live date change?", "How often has the vendor choice changed?", "What is the number of changes to the pilot budget?"):
            self.assertEqual(self.route(q).type, "n_changes", q)

    def test_a_date_makes_it_an_as_of_question(self):
        r = self.route("What was the pilot budget on 27 September 2026?")
        self.assertEqual((r.type, r.object_id, r.valid_at, r.tx_at), ("as_of_valid", "budget", "2026-09-27", None))

    def test_recorded_by_a_date_needs_two_dates(self):
        r = self.route("Going by what had been recorded by 6 October 2026, what was the go-live date for 16 October 2026?")
        self.assertEqual((r.type, r.valid_at, r.tx_at), ("as_of_tx", "2026-10-16", "2026-10-06"))

    def test_no_tracked_item_or_an_ambiguous_one_fails_cleanly(self):
        r = self.route("What is the weather like in Cyberjaya?")
        self.assertFalse(r.ok)
        self.assertIn("no tracked item", r.reason)
        self.assertFalse(self.route("").ok)

    def test_cue_words(self):
        self.assertTrue(AS_RECORDED.search("what had been recorded by 6 October"))
        self.assertTrue(AS_RECORDED.search("as known on 3 May"))
        self.assertFalse(AS_RECORDED.search("what had been decided as of 5 February"))


class FakeLLM:
    """Returns a scripted reply for the router prompt."""

    def __init__(self, reply):
        self.reply = reply

    def complete(self, prompt, max_tokens=None):
        return {"text": self.reply, "seconds": 0.1, "prompt_tokens": 10, "output_tokens": 5}


class ServiceAskTest(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.home, True)
        self.svc = Service(self.home, extractor="none")
        handle(self.svc, json.dumps({"id": 1, "method": "registry.set", "params": json.loads(DEMO.read_text())}))

    def ask(self, reply, question):
        self.svc._llm = FakeLLM(reply)
        return handle(self.svc, json.dumps({"id": 2, "method": "ask", "params": {"question": question}}))["result"]

    def test_an_unusable_model_reply_falls_back_to_the_rules(self):
        out = self.ask("I am not sure what you mean.", "How many times did the go-live date change?")
        self.assertTrue(out["ok"])
        self.assertEqual((out["route_source"], out["route"]["type"], out["answer"]), ("rules", "n_changes", 0))

    def test_a_good_model_route_is_used_as_it_is(self):
        reply = '{"type":"current","object_id":"vendor","attribute":"outcome","valid_at":null,"tx_at":null}'
        out = self.ask(reply, "Which vendor now?")
        self.assertEqual(out["route_source"], "model")

    def test_as_recorded_without_a_cue_becomes_valid_on_a_date(self):
        reply = '{"type":"as_of_tx","object_id":"budget","attribute":"amount","valid_at":"2026-09-27","tx_at":"2026-09-27"}'
        out = self.ask(reply, "What had been decided about the pilot budget as of 27 September 2026?")
        self.assertEqual((out["route"]["type"], out["route"]["tx_at"], out["route_source"]), ("as_of_valid", None, "model, corrected by a rule"))

    def test_as_recorded_with_a_cue_is_kept(self):
        reply = '{"type":"as_of_tx","object_id":"golive","attribute":"date","valid_at":"2026-10-16","tx_at":"2026-10-06"}'
        out = self.ask(reply, "Going by what had been recorded by 6 October 2026, what was the go-live date for 16 October 2026?")
        self.assertEqual(out["route"]["type"], "as_of_tx")

    def test_when_both_fail_the_answer_says_so(self):
        out = self.ask("nonsense", "Tell me a joke")
        self.assertFalse(out["ok"])


if __name__ == "__main__":
    unittest.main()
