"""Gaps found in the service while integrating it with the app (SVC-01..SVC-04 in results/testing/defect_log.md), now fixed."""
import json
import shutil
import tempfile
import unittest

from memoria_engine.pipeline import Candidate
from memoria_engine.service import Service, handle

REGISTRY = {"objects": [
    {"object_id": "vendor", "kind": "decision", "label": "Which CRM vendor",
     "attributes": [{"name": "outcome", "type": "enum", "values": ["Vendor A", "Vendor B"], "change_kind": "REVERSE"}]},
    {"object_id": "launch", "kind": "commitment", "label": "Launch the pilot",
     "attributes": [{"name": "owner", "type": "person"}, {"name": "deadline", "type": "date"}]}],
    "people": {"ali": "Ali", "wei_ling": "Wei Ling"}}


class Scripted:
    name = "scripted"

    def __init__(self, candidates):
        self.candidates, self.last_stats = candidates, {}

    def extract(self, ctx):
        return self.candidates


class HardeningTest(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.home, True)
        self.svc = Service(self.home, extractor="none")
        self.script = []
        self.svc.extractor = lambda kind: None if kind == "none" else Scripted(self.script)
        self.assertTrue(self.call("registry.set", **REGISTRY)["ok"])

    def call(self, method, **params):
        return handle(self.svc, json.dumps({"id": 1, "method": method, "params": params}))

    def first_meeting(self):
        self.script[:] = [Candidate("launch", "owner", "ali", "Ali, you own the pilot launch", 1, None, 0.9),
                          Candidate("launch", "deadline", "2026-03-15", "by 15 March", 1, None, 0.8)]
        turns = [{"speaker": "Chair", "text": "Let us start."}, {"speaker": "Chair", "text": "Ali, you own the pilot launch, by 15 March."}]
        return self.call("meetings.ingest", meeting_id="m1", occurred_at="2026-03-02T09:00:00Z", extractor="mlx", turns=turns)

    def fact(self, attribute):
        return next(f for f in self.call("facts.current")["result"] if f["attribute"] == attribute)

    def test_svc01_the_same_meeting_cannot_be_ingested_twice(self):
        self.assertTrue(self.first_meeting()["ok"])
        again = self.first_meeting()
        self.assertFalse(again["ok"], "a second ingestion of m1 must be refused, not silently stored again")
        self.assertEqual(len(self.call("meetings.list")["result"]), 1)

    def test_svc02_a_corrected_person_is_stored_as_the_person_id(self):
        self.first_meeting()
        fact = self.fact("owner")
        self.assertTrue(self.call("facts.correct", fact_id=fact["fact_id"], value="Wei Ling", reason="Aisha moved it")["ok"])
        self.assertEqual(self.fact("owner")["value"], "wei_ling")

    def test_svc03_a_corrected_date_must_be_an_iso_date(self):
        self.first_meeting()
        fact = self.fact("deadline")
        reply = self.call("facts.correct", fact_id=fact["fact_id"], value="soon-ish", reason="typo")
        self.assertFalse(reply["ok"], "a free-text date must be refused like the extractor path refuses it")

    def test_svc04_history_shows_who_corrected_a_fact_and_why(self):
        self.first_meeting()
        fact = self.fact("deadline")
        self.assertTrue(self.call("facts.correct", fact_id=fact["fact_id"], value="2026-03-20", reason="client asked for later", reviewer="Aisha")["ok"])
        history = self.call("facts.history", object_id="launch", attribute="deadline")["result"]
        corrected = [h for h in history if h.get("correction")]
        self.assertEqual(len(corrected), 1)
        self.assertEqual(corrected[0]["correction"]["reason"], "client asked for later")
        self.assertEqual(corrected[0]["correction"]["reviewer"], "Aisha")
        self.assertEqual(corrected[0]["value"], "2026-03-20")


if __name__ == "__main__":
    unittest.main()
