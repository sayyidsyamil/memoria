import json
import unittest

from context import load_chain
from stop_rule import EventRepeatStop, analyse, conservative


class StopRuleTests(unittest.TestCase):
    def event(self, **fields):
        return {"turn": 2, "quote": 'Use {braces}, \\ and "quotes".', "object_id": "vendor",
                "attribute": "outcome", "value": "A", "unresolved": False, **fields}

    def test_arbitrary_chunks_escaped_strings_and_closure(self):
        event = self.event()
        text = json.dumps({"events": [event, event, self.event(value="B")]})
        for width in (1, 2, 7, len(text)):
            detector = EventRepeatStop()
            for i in range(0, len(text), width):
                if detector.feed(text[i:i + width]):
                    break
            self.assertEqual(json.loads(detector.closed_text()), {"events": [event]})
            self.assertLess(detector.observed_end, len(text))

    def test_distinct_decisions_same_quote_are_not_repeats(self):
        events = [self.event(), self.event(value="B"), self.event(turn=3), self.event(quote="Different")]
        text = json.dumps({"events": events})
        detector = analyse(text)
        self.assertIsNone(detector.reason)
        self.assertEqual(detector.closed_text(), text)

    def test_key_order_insensitive_but_quote_whitespace_sensitive(self):
        a = self.event()
        b = dict(reversed(list(a.items())))
        self.assertTrue(analyse(json.dumps({"events": [a, b]})).reason)
        b["quote"] = a["quote"].replace(" ", "  ")
        self.assertIsNone(analyse(json.dumps({"events": [a, b]})).reason)

    def test_nested_values_do_not_end_event_early(self):
        event = self.event(value={"nested": [{"x": "}"}]})
        detector = analyse(json.dumps({"events": [event, event]}))
        self.assertEqual(json.loads(detector.closed_text())["events"], [event])

    def test_partial_event_and_other_endpoints_do_not_trigger(self):
        event = json.dumps(self.event())
        self.assertIsNone(analyse('{"events":[' + event + ',' + event[:-1]).reason)
        self.assertIsNone(analyse('{"other":[' + event + ',' + event + ']}').reason)
        self.assertIsNone(analyse('{"events":[]}').reason)

    def test_reserved_loader_is_rejected_before_io(self):
        for name in ("ES2004", "ES2002", "demo", "../data"):
            with self.assertRaises(ValueError):
                load_chain(name)

    def test_first_repeat_has_a_real_recovery_counterexample(self):
        a, b = self.event(), self.event(object_id="screen", value="included")
        text = json.dumps({"events": [a, a, b]})
        self.assertNotIn(b, json.loads(analyse(text).closed_text())["events"])
        detector = conservative()
        self.assertFalse(detector.feed(text))
        self.assertEqual(detector.closed_text(), text)

    def test_valid_repeats_never_trigger_conservative_rule(self):
        a, b = self.event(), self.event(value="B", turn=9)
        text = json.dumps({"events": [a] * 8 + [b]})
        detector = conservative()
        self.assertFalse(detector.feed(text))
        self.assertEqual(json.loads(detector.closed_text())["events"][-1], b)

    def test_short_unresolved_burst_can_recover(self):
        u, b = self.event(unresolved=True), self.event(value="B")
        for count in (2, 3):
            text = json.dumps({"events": [u] * count + [b]})
            detector = conservative()
            self.assertFalse(detector.feed(text))
            self.assertEqual(json.loads(detector.closed_text())["events"][-1], b)

    def test_long_unresolved_recovery_is_a_documented_limit(self):
        u, b = self.event(unresolved=True), self.event(value="B")
        detector = conservative()
        self.assertTrue(detector.feed(json.dumps({"events": [u] * 4 + [b]})))
        self.assertNotIn(b, json.loads(detector.closed_text())["events"])


if __name__ == "__main__":
    unittest.main()
