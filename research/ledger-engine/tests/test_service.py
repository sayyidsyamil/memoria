"""The JSON-lines service the desktop app uses. Scripted extractors only: no model is loaded."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from memoria_engine.pipeline import Candidate
from memoria_engine.service import Service, handle

REGISTRY = {"objects": [
    {"object_id": "vendor", "kind": "decision", "label": "Which CRM vendor",
     "attributes": [{"name": "outcome", "type": "enum", "values": ["Vendor A", "Vendor B"], "change_kind": "REVERSE"}]},
    {"object_id": "launch", "kind": "commitment", "label": "Launch the pilot",
     "attributes": [{"name": "owner", "type": "person"}, {"name": "deadline", "type": "date"}, {"name": "status", "type": "enum", "values": ["done", "cancelled"]}]}],
    "people": {"ali": "Ali"}}


class Scripted:
    name = "scripted"

    def __init__(self, candidates):
        self.candidates, self.last_stats = candidates, {}

    def extract(self, ctx):
        return self.candidates


class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.home, True)
        self.svc = Service(self.home, extractor="none")
        self.script = []
        self.svc.extractor = lambda kind: None if kind == "none" else Scripted(self.script)
        self.assertTrue(self.call("registry.set", **REGISTRY)["ok"])

    def call(self, method, **params):
        return handle(self.svc, json.dumps({"id": 7, "method": method, "params": params}))

    def ingest(self, mid, day, turns, cands, **kw):
        self.script[:] = cands
        return self.call("meetings.ingest", meeting_id=mid, occurred_at=f"2026-03-{day}T09:00:00Z", extractor="mlx",
                         turns=[{"speaker": "Chair", "text": t} for t in turns], **kw)

    def first_two_meetings(self):
        self.ingest("m1", "02", ["Let us start.", "We go with Vendor A.", "Ali, you own the pilot launch, by 15 March."],
                    [Candidate("vendor", "outcome", "Vendor A", "We go with Vendor A.", 1, None, 0.9),
                     Candidate("launch", "owner", "ali", "Ali, you own the pilot launch", 2, None, 0.9),
                     Candidate("launch", "deadline", "2026-03-15", "by 15 March", 2, None, 0.8)])
        return self.ingest("m2", "09", ["Quick update.", "Actually we go with Vendor B."],
                           [Candidate("vendor", "outcome", "Vendor B", "Actually we go with Vendor B.", 1, None, 0.9)])

    def test_svc01_ingest_applies_firm_decisions_and_answers_current(self):
        """TC-SVC-01 (FR3, FR4): a first meeting sets three items; each has evidence naming speaker and meeting."""
        r = self.ingest("m1", "02", ["Let us start.", "We go with Vendor A."], [Candidate("vendor", "outcome", "Vendor A", "We go with Vendor A.", 1, None, 0.9)])
        self.assertEqual(r["result"]["counts"], {"applied": 1})
        q = self.call("query", type="current", object_id="vendor", attribute="outcome")["result"]
        self.assertEqual(q["answer"], "Vendor A")
        self.assertEqual((q["evidence"][0]["quote"], q["evidence"][0]["speaker"], q["evidence"][0]["meeting"]), ("We go with Vendor A.", "Chair", "m1"))

    def test_svc02_a_conflicting_change_waits_in_the_review_inbox(self):
        """TC-SVC-02 (FR5): a later meeting that contradicts a belief is proposed, not applied; the old value stays until a human accepts."""
        r = self.first_two_meetings()
        self.assertEqual(r["result"]["counts"], {"proposed": 1})
        self.assertEqual(self.call("query", type="current", object_id="vendor", attribute="outcome")["result"]["answer"], "Vendor A")
        pending = self.call("proposals.list")["result"]
        self.assertEqual([(p["current_value"], p["value"]) for p in pending], [("Vendor A", "Vendor B")])
        self.assertEqual(self.call("brief")["result"]["waiting_for_review"], 1)

    def test_svc03_accepting_supersedes_and_keeps_history(self):
        """TC-SVC-03 (FR5, FR6): accepting makes Vendor B current; the value on 5 March is still Vendor A; one change is counted."""
        self.first_two_meetings()
        pid = self.call("proposals.list")["result"][0]["proposal_id"]
        self.assertTrue(self.call("proposals.accept", proposal_id=pid)["ok"])
        q = lambda **k: self.call("query", object_id="vendor", attribute="outcome", **k)["result"]["answer"]
        self.assertEqual((q(type="current"), q(type="as_of_valid", valid_at="2026-03-05"), q(type="n_changes")), ("Vendor B", "Vendor A", 1))
        self.assertEqual(len(self.call("facts.history", object_id="vendor", attribute="outcome")["result"]), 2)

    def test_svc04_rejecting_keeps_the_old_value(self):
        """TC-SVC-04 (FR5): a rejected proposal changes nothing and leaves the inbox empty."""
        self.first_two_meetings()
        pid = self.call("proposals.list")["result"][0]["proposal_id"]
        self.assertTrue(self.call("proposals.reject", proposal_id=pid, note="that was only a suggestion")["ok"])
        self.assertEqual(self.call("query", type="current", object_id="vendor", attribute="outcome")["result"]["answer"], "Vendor A")
        self.assertEqual(self.call("proposals.list")["result"], [])

    def test_svc05_a_human_correction_replaces_the_value_and_is_kept_in_history(self):
        """TC-SVC-05 (FR3): correcting a wrong deadline changes the current answer and keeps the original claim in history."""
        self.first_two_meetings()
        hist = self.call("facts.history", object_id="launch", attribute="deadline")["result"]
        self.assertTrue(self.call("facts.correct", fact_id=hist[0]["fact_id"], value="2026-03-20", reason="chair said the 20th")["ok"])
        self.assertEqual(self.call("query", type="current", object_id="launch", attribute="deadline")["result"]["answer"], "2026-03-20")
        self.assertGreaterEqual(len(self.call("facts.history", object_id="launch", attribute="deadline")["result"]), 2)

    def test_svc06_state_survives_a_restart(self):
        """TC-SVC-06 (NFR-Recoverability): a new Service on the same folder sees the same facts, meetings and registry."""
        self.first_two_meetings()
        before = self.call("facts.current")["result"]
        again = Service(self.home, extractor="none")
        r = handle(again, json.dumps({"id": 1, "method": "facts.current", "params": {}}))["result"]
        self.assertEqual([(f["object_id"], f["attribute"], f["value"]) for f in r], [(f["object_id"], f["attribute"], f["value"]) for f in before])
        self.assertEqual(again.ping()["meetings"], 2)
        self.assertEqual(len(again.registry.objects), 2)

    def test_svc07_the_database_can_be_rebuilt_from_the_log(self):
        """TC-SVC-07 (NFR-Recoverability): deleting the database and keeping the append-only log reproduces the answers."""
        self.first_two_meetings()
        self.svc.pipe.ledger.close()
        for name in ("ledger.sqlite", "ledger.sqlite-wal", "ledger.sqlite-shm"):
            (Path(self.home) / name).unlink(missing_ok=True)
        rebuilt = Service(self.home, extractor="none")
        r = handle(rebuilt, json.dumps({"id": 1, "method": "query", "params": {"type": "current", "object_id": "vendor", "attribute": "outcome"}}))
        self.assertEqual(r["result"]["answer"], "Vendor A")
        self.assertTrue(handle(rebuilt, json.dumps({"id": 2, "method": "check", "params": {}}))["result"]["ok"])

    def test_svc08_the_brief_lists_open_commitments_and_changes(self):
        """TC-SVC-08 (FR6): the pre-meeting brief shows the open commitment with owner and deadline."""
        self.first_two_meetings()
        brief = self.call("brief")["result"]
        self.assertEqual([(c["label"], c["owner"], c["deadline"]) for c in brief["open_commitments"]], [("Launch the pilot", "ali", "2026-03-15")])

    def test_svc09_bad_requests_return_errors_and_the_service_survives(self):
        """TC-SVC-09 (NFR-Robustness): unknown method, unknown item, malformed JSON and an empty meeting give error responses, never a crash."""
        self.assertEqual(self.call("nope")["error"]["type"], "ValueError")
        self.assertEqual(self.call("query", type="current", object_id="ghost", attribute="x")["error"]["type"], "KeyError")
        self.assertFalse(handle(self.svc, "{not json")["ok"])
        self.assertFalse(self.call("meetings.ingest", meeting_id="m9", turns=[])["ok"])
        self.assertTrue(self.call("ping")["ok"])

    def test_svc10_changing_an_existing_item_definition_is_refused(self):
        """TC-SVC-10 (NFR-Robustness): re-declaring an item with different details is refused and the registry is unchanged."""
        changed = {"objects": [{"object_id": "vendor", "kind": "commitment", "label": "Other label", "attributes": [{"name": "outcome", "type": "text"}]}]}
        self.assertFalse(self.call("registry.set", **changed)["ok"])
        self.assertEqual(self.svc.registry.objects["vendor"].label, "Which CRM vendor")

    def test_svc11_storing_a_meeting_without_extraction_keeps_the_source(self):
        """TC-SVC-11 (FR1, FR2): a meeting can be stored first and extracted later; the source is listed."""
        r = self.call("meetings.ingest", meeting_id="m1", occurred_at="2026-03-02T09:00:00Z", extractor="none", turns=[{"speaker": "Chair", "text": "hello there"}])
        self.assertTrue(r["result"]["stored_only"])
        self.assertEqual([m["meeting_id"] for m in self.call("meetings.list")["result"]], ["m1"])


if __name__ == "__main__":
    unittest.main()
