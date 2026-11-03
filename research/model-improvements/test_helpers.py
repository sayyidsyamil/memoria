"""Self-checks for the no-model helpers: python3.11 test_helpers.py"""
import sys
import unittest

sys.dont_write_bytecode = True
import harness  # noqa: E402,F401  (puts the app's memory folder on the path)
import numwords  # noqa: E402
from memoria_engine.pipeline import Candidate  # noqa: E402


class NumberWords(unittest.TestCase):
    def test_spelled_amounts(self):
        cases = {"As you can see, twelve point five Euros per unit.": [12.5], "sell them for twenty five.": [25],
                 "twenty-five euros": [25], "one hundred and fifty thousand": [150000], "a hundred and fifty": [150],
                 "two point five million ringgit": [2500000], "fifty million Euros": [50000000], "five six seven": [5, 6, 7],
                 "it costs twelve fifty": [12, 50], "half of the selling price": [], "eleven point two Euros": [11.2]}
        for text, want in cases.items():
            self.assertEqual(numwords.word_numbers(text), want, text)

    def test_words_confirm_but_never_replace(self):
        from memoria_engine.service import registry_from_json
        registry = registry_from_json({"objects": [{"object_id": "price", "label": "Selling price (euro)", "kind": "decision",
                                                    "attributes": [{"name": "amount", "type": "number"}]}]})
        fix = lambda value, quote: numwords.repaired(Candidate("price", "amount", value, quote), registry)
        self.assertEqual(fix(12.5, "twelve point five Euros per unit").value, 12.5)
        self.assertEqual(fix(25, "we're hoping to sell them for twenty five").value, 25)
        self.assertIsNone(fix(25, "we're hoping to sell them for thirty"))  # words do not replace a value
        self.assertIsNone(fix(25, "no change to the price"))
        self.assertEqual(fix(2500000, "the price is 250,000").value, 250000)  # the app's own digit repair is unchanged


class Repeats(unittest.TestCase):
    def test_cut_at_first_repeated_event(self):
        event = '{"turn":1,"quote":"a","object_id":"x","attribute":"y","value":"z"}'
        text = '{"events":[' + event + "," + '{"turn":2,"quote":"b"}' + "," + event + "," + event
        cut = harness.cut_at_repeat(text)
        self.assertEqual(cut, '{"events":[' + event + "," + '{"turn":2,"quote":"b"}' + ",")
        self.assertEqual(harness.duplicate_events(text), 2)
        self.assertIsNone(harness.cut_at_repeat('{"events":[' + event + "]}"))


if __name__ == "__main__":
    unittest.main()
