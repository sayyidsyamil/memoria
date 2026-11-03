import json
import unittest

from context import load_chain
from stop_rule import EventRepeatStop, analyse


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


if __name__ == "__main__":
    unittest.main()
