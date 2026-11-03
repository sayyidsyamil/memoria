import json
import unittest

from probe_activations import event_spans


class ProbeHelperTests(unittest.TestCase):
    def test_spans_respect_embedded_braces_and_partial_tail(self):
        objects = [{"quote": 'literal } { "', "value": {"nested": 2}}, {"quote": "next", "value": 3}]
        prefix = '{"events":[' + ','.join(json.dumps(o) for o in objects)
        text = prefix + ',{"quote":"unfinished'
        spans = event_spans(text)
        self.assertEqual([json.loads(text[a:b]) for a, b in spans], objects)

    def test_only_events_endpoint(self):
        self.assertEqual(event_spans('{"other":[{"quote":"q"}]}'), [])
        self.assertEqual(event_spans('{"events":[]}'), [])


if __name__ == "__main__":
    unittest.main()
