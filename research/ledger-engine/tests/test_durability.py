import os
import sqlite3
import tempfile
import unittest

from helpers import Clock, Env
from memoria_engine import Evidence, InvalidAssertion, Ledger, LogCorrupt


class TestSchemaGuards(unittest.TestCase):
    """The database itself refuses to break the bitemporal rules, whatever the Python code does."""

    def setUp(self):
        self.E = Env()
        self.E.clock.t = 1000
        self.a = self.E.say("dec1", "outcome", "A", 100)
        self.db = self.E.L._db

    def insert_belief(self, valid_from, valid_to, tx_start=9000, tx_end=None):
        self.db.execute(
            "INSERT INTO validity(fact_id, object_id, attribute, discriminator, valid_from, valid_to, tx_start, tx_end) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (self.a.fact_id, "dec1", "outcome", "", valid_from, valid_to, tx_start, tx_end))

    def test_overlapping_current_beliefs_are_refused(self):
        for start, end in ((500, None), (150, 160)):
            with self.subTest(start=start), self.assertRaisesRegex(sqlite3.IntegrityError, "overlapping"):
                self.insert_belief(start, end)

    def test_the_unique_index_alone_also_blocks_two_open_beliefs(self):
        self.db.execute("DROP TRIGGER validity_no_overlap")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "UNIQUE"):
            self.insert_belief(500, None)

    def test_interval_checks(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_belief(10, 10, tx_end=None)
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_belief(10, 20, tx_start=500, tx_end=500)

    def test_history_cannot_be_edited_or_deleted(self):
        statements = [
            "UPDATE facts SET value_json = '\"x\"'", "DELETE FROM facts",
            "UPDATE evidence SET span_text = 'x'", "DELETE FROM evidence",
            "UPDATE sources SET meeting_id = 'x'", "DELETE FROM sources",
            "UPDATE objects SET label = 'x'", "DELETE FROM objects",
            "UPDATE validity SET valid_to = 150", "UPDATE validity SET valid_from = 1",
            "UPDATE validity SET tx_start = 1", "DELETE FROM validity",
        ]
        for sql in statements:
            with self.subTest(sql=sql), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(sql)

    def test_a_belief_can_only_be_expired_never_reopened(self):
        self.db.execute("UPDATE validity SET tx_end = 5000 WHERE tx_end IS NULL")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE validity SET tx_end = NULL")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE validity SET tx_end = 6000")


class TestEventLog(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.log = os.path.join(self.tmp.name, "events.jsonl")
        self.db = os.path.join(self.tmp.name, "cache.db")

    def build(self, **kw):
        E = Env(log_path=self.log, **kw)
        E.clock.t = 1000
        a = E.say("dec1", "outcome", "Vendor A", 100)
        E.clock.t = 2000
        pid = E.L.propose("dec1", "outcome", "Vendor B", E.ev(200), confidence=0.7)
        b = E.L.accept(pid, "najib")
        E.clock.t = 3000
        E.L.correct(b.fact_id, "ana", "misheard", value="Vendor C")
        E.clock.t = 4000
        E.say("c1", "deadline", "2026-03-01", 100)
        E.say("c1", "deadline", "2026-03-01", 300)  # a reconfirmation
        E.L.retract(a.fact_id, "ana", "wrong meeting")
        E.L.add_entity("project_alpha", "project", "Project Alpha")
        E.L.add_alias("Projek Alpha", "project_alpha", lang="ms")
        return E

    def lines(self):
        with open(self.log, encoding="utf-8") as f:
            return f.read().splitlines()

    def test_replaying_the_log_rebuilds_an_identical_database(self):
        original = self.build().L.dump()
        self.assertEqual(Ledger(":memory:", log_path=self.log).dump(), original)

    def test_the_database_file_is_a_disposable_cache(self):
        E = self.build(db_path=self.db)
        original = E.L.dump()
        E.L.close()
        for suffix in ("", "-wal", "-shm"):
            if os.path.exists(self.db + suffix):
                os.remove(self.db + suffix)
        self.assertEqual(Ledger(self.db, log_path=self.log).dump(), original)

    def test_a_database_that_is_behind_the_log_catches_up(self):
        original = self.build().L.dump()
        full = self.lines()
        half = len(full) // 2
        partial_log = os.path.join(self.tmp.name, "partial.jsonl")
        with open(partial_log, "w", encoding="utf-8") as f:
            f.write("\n".join(full[:half]) + "\n")
        Ledger(self.db, log_path=partial_log).close()
        with open(partial_log, "w", encoding="utf-8") as f:
            f.write("\n".join(full) + "\n")
        caught_up = Ledger(self.db, log_path=partial_log)
        self.assertEqual(caught_up.dump(), original)
        self.assertEqual(caught_up.check_invariants(), [])

    def test_failed_writes_are_not_logged(self):
        E = self.build()
        ev = E.ev(100)
        before = self.lines()
        with self.assertRaises(InvalidAssertion):
            E.L.assert_fact("dec1", "outcome", float("nan"), ev)
        self.assertEqual(self.lines(), before)

    def test_ensuring_something_that_already_exists_is_not_logged(self):
        E = self.build()
        before = self.lines()
        E.ev(100)
        E.L.add_entity("project_alpha", "project", "Project Alpha")
        E.L.add_alias("Projek Alpha", "project_alpha", lang="ms")
        E.L.define_attribute("outcome", "one")
        E.L.create_object("dec1", "decision", issue_id="issue1")
        self.assertEqual(self.lines(), before)

    def test_a_partial_trailing_line_is_dropped(self):
        original = self.build().L.dump()
        before = self.lines()
        with open(self.log, "a", encoding="utf-8") as f:
            f.write('{"seq": 99, "tx": 1')
        self.assertEqual(Ledger(":memory:", log_path=self.log).dump(), original)
        self.assertEqual(self.lines(), before)

    def test_corrupt_logs_are_rejected(self):
        self.build()
        original = self.lines()
        variants = {
            "missing line": original[:5] + original[6:],
            "garbage": original[:5] + ["not json"] + original[6:],
            "unknown op": original[:5] + [original[5].replace('"op":"', '"op":"x_')] + original[6:],
        }
        for name, lines in variants.items():
            with self.subTest(name):
                with open(self.log, "w", encoding="utf-8") as f:
                    f.write("\n".join(lines) + "\n")
                with self.assertRaises(LogCorrupt):
                    Ledger(":memory:", log_path=self.log)

    def test_a_database_ahead_of_its_log_is_rejected(self):
        E = self.build(db_path=self.db)
        E.L.close()
        kept = self.lines()[:5]
        with open(self.log, "w", encoding="utf-8") as f:
            f.write("\n".join(kept) + "\n")
        with self.assertRaises(LogCorrupt):
            Ledger(self.db, log_path=self.log)

    def test_transaction_time_survives_a_restart_even_if_the_clock_went_back(self):
        E = Env(db_path=self.db, log_path=self.log)
        E.clock.t = 10_000
        first = E.say("dec1", "outcome", "A", 100).tx
        E.L.close()
        reopened = Ledger(self.db, log_path=self.log, clock=Clock(1))
        evidence = Evidence(reopened.add_source("chunk@200", "m1", 200), "agreed")
        self.assertGreater(reopened.assert_fact("dec1", "outcome", "B", evidence).tx, first)


if __name__ == "__main__":
    unittest.main()
