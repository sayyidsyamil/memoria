"""Tests for the voice profile store. numpy only; no model and no mlx import.

Run from the app folder:  python3.11 -m unittest discover -s tests/python
"""

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

PYTHON_DIR = Path(__file__).resolve().parents[2] / "src-tauri" / "resources" / "python"
sys.path.insert(0, str(PYTHON_DIR))

import voice_store  # noqa: E402

AISHA = [0.1, 0.2, 0.3]
RAJ = [0.4, 0.5, 0.6]
STRANGER = [0.7, 0.8, 0.9]


def three_speakers():
    return {"Speaker 0": AISHA, "Speaker 1": RAJ, "Speaker 2": STRANGER}


def all_files(base):
    return sorted(p for p in Path(base).rglob("*") if p.is_file())


def all_text(base):
    return "".join(p.read_text() for p in all_files(base))


class VoiceStoreTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.base = Path(self._tmp.name) / ".memoria"

    def test_off_writes_nothing_at_all(self):
        self.assertEqual(voice_store.save_session(False, three_speakers(), self.base), "")
        self.assertFalse(self.base.exists())

    def test_on_with_no_speakers_writes_nothing(self):
        self.assertEqual(voice_store.save_session(True, {}, self.base), "")
        self.assertFalse(self.base.exists())

    def test_on_keeps_a_session_file_only_until_the_user_decides(self):
        session = voice_store.save_session(True, three_speakers(), self.base)
        self.assertEqual(len(all_files(self.base)), 1)
        self.assertTrue((self.base / "sessions" / f"{session}.json").exists())

    def test_only_named_speakers_are_enrolled(self):
        session = voice_store.save_session(True, three_speakers(), self.base)
        enrolled = voice_store.enroll_session(session, {"Speaker 0": "Aisha", "Speaker 1": "  ", "Speaker 2": "Speaker 2"}, self.base)
        self.assertEqual(enrolled, ["Aisha"])
        self.assertEqual(voice_store.load_voices(self.base), {"Aisha": [AISHA]})
        stored = all_text(self.base)
        for secret in (RAJ, STRANGER):
            self.assertNotIn(str(secret[0]), stored)

    def test_session_file_is_removed_after_enrolment(self):
        session = voice_store.save_session(True, three_speakers(), self.base)
        voice_store.enroll_session(session, {"Speaker 0": "Aisha"}, self.base)
        self.assertEqual([p.name for p in all_files(self.base)], ["voices.json"])

    def test_nobody_named_stores_no_voice_and_deletes_the_session(self):
        session = voice_store.save_session(True, three_speakers(), self.base)
        self.assertEqual(voice_store.enroll_session(session, {}, self.base), [])
        self.assertEqual(all_files(self.base), [])

    def test_closing_the_panel_discards_everything(self):
        session = voice_store.save_session(True, three_speakers(), self.base)
        voice_store.discard_session(session, self.base)
        self.assertEqual(all_files(self.base), [])
        voice_store.discard_session(session, self.base)  # idempotent
        voice_store.discard_session("", self.base)

    def test_enrolling_twice_changes_nothing_the_second_time(self):
        session = voice_store.save_session(True, three_speakers(), self.base)
        voice_store.enroll_session(session, {"Speaker 0": "Aisha"}, self.base)
        before = (self.base / "voices.json").read_text()
        self.assertEqual(voice_store.enroll_session(session, {"Speaker 0": "Aisha"}, self.base), [])
        self.assertEqual((self.base / "voices.json").read_text(), before)

    def test_delete_all_removes_profiles_and_sessions_and_is_repeatable(self):
        done = voice_store.save_session(True, three_speakers(), self.base)
        voice_store.enroll_session(done, {"Speaker 0": "Aisha"}, self.base)
        voice_store.save_session(True, three_speakers(), self.base)  # a pending session
        self.assertEqual(voice_store.delete_all(self.base), 2)
        self.assertEqual(all_files(self.base), [])
        self.assertEqual(voice_store.delete_all(self.base), 0)
        self.assertEqual(voice_store.delete_all(Path(self._tmp.name) / "missing"), 0)

    def test_files_are_owner_only(self):
        session = voice_store.save_session(True, three_speakers(), self.base)
        self.assertEqual((self.base / "sessions" / f"{session}.json").stat().st_mode & 0o777, 0o600)
        voice_store.enroll_session(session, {"Speaker 0": "Aisha"}, self.base)
        self.assertEqual((self.base / "voices.json").stat().st_mode & 0o777, 0o600)

    def test_each_voice_keeps_only_the_latest_samples(self):
        for i in range(voice_store.MAX_SAMPLES_PER_VOICE + 3):
            session = voice_store.save_session(True, {"Speaker 0": [float(i)]}, self.base)
            voice_store.enroll_session(session, {"Speaker 0": "Aisha"}, self.base)
        samples = voice_store.load_voices(self.base)["Aisha"]
        self.assertEqual(len(samples), voice_store.MAX_SAMPLES_PER_VOICE)
        self.assertEqual(samples[-1], [float(voice_store.MAX_SAMPLES_PER_VOICE + 2)])

    def test_session_ids_cannot_escape_the_folder(self):
        outside = Path(self._tmp.name) / "outside.json"
        outside.write_text("{}")
        voice_store.discard_session("../../outside", self.base)
        self.assertEqual(voice_store.enroll_session("../../outside", {"Speaker 0": "Aisha"}, self.base), [])
        self.assertTrue(outside.exists())

    def test_stale_session_files_are_swept_and_fresh_ones_kept(self):
        old = voice_store.save_session(True, three_speakers(), self.base)
        fresh = voice_store.save_session(True, three_speakers(), self.base)
        old_path = self.base / "sessions" / f"{old}.json"
        long_ago = time.time() - voice_store.SESSION_MAX_AGE_S - 60
        os.utime(old_path, (long_ago, long_ago))
        self.assertEqual(voice_store.sweep_stale_sessions(self.base), 1)
        self.assertFalse(old_path.exists())
        self.assertTrue((self.base / "sessions" / f"{fresh}.json").exists())
        self.assertEqual(voice_store.sweep_stale_sessions(Path(self._tmp.name) / "missing"), 0)

    def test_best_match_finds_the_enrolled_voice(self):
        voices = {"Aisha": [[1.0, 0.0]], "Raj": [[0.0, 1.0]]}
        import numpy as np
        name, score = voice_store.best_match(np.array([0.9, 0.1], dtype=np.float32), voices)
        self.assertEqual(name, "Aisha")
        self.assertGreater(score, 0.8)
        self.assertEqual(voice_store.best_match(np.array([1.0, 0.0], dtype=np.float32), {}), (None, 0.0))

    def test_command_line_enrols_and_discards(self):
        session = voice_store.save_session(True, three_speakers(), self.base)
        previous = voice_store.DEFAULT_BASE
        try:
            # The CLI uses the default folder, so point the module at the test folder for this call.
            for name in ("load_voices", "save_voices", "save_session", "discard_session", "enroll_session", "sweep_stale_sessions", "delete_all"):
                func = getattr(voice_store, name)
                func.__defaults__ = tuple(self.base if d == previous else d for d in (func.__defaults__ or ()))
            self.assertEqual(voice_store.main(["enroll", session, "--labels", json.dumps({"Speaker 1": "Raj"})]), 0)
            self.assertEqual(list(voice_store.load_voices().keys()), ["Raj"])
            pending = voice_store.save_session(True, three_speakers())
            self.assertEqual(voice_store.main(["discard", pending]), 0)
            self.assertEqual([p.name for p in all_files(self.base)], ["voices.json"])
            self.assertEqual(voice_store.main(["sweep"]), 0)
        finally:
            for name in ("load_voices", "save_voices", "save_session", "discard_session", "enroll_session", "sweep_stale_sessions", "delete_all"):
                func = getattr(voice_store, name)
                func.__defaults__ = tuple(previous if d == self.base else d for d in (func.__defaults__ or ()))

    def test_the_live_script_stores_nothing_itself(self):
        source = (PYTHON_DIR / "transcribe_server.py").read_text()
        self.assertNotIn("write_text(", source)
        self.assertNotIn(".memoria", source.split('"""')[2])  # no path logic outside the docstring


if __name__ == "__main__":
    unittest.main()
