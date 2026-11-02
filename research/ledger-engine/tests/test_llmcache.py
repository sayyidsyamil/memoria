"""Tests for the recording wrapper around the language model (no model is loaded: the inner call is replaced)."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from memoria_engine.extractors import MLXExtractor
from memoria_engine.llmcache import CachingMLX


class Fake:
    """Stands in for MLXExtractor.complete and counts calls."""

    def __init__(self):
        self.calls = []

    def __call__(self, prompt, max_tokens=None):
        self.calls.append((prompt, max_tokens))
        return {"text": f"answer to: {prompt}", "seconds": 1.25, "prompt_tokens": len(prompt.split()), "output_tokens": 4}


class CachingTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = str(Path(self.dir.name) / "nested" / "calls.jsonl")
        self.fake = Fake()
        patcher = mock.patch.object(MLXExtractor, "complete", self.fake)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.dir.cleanup)

    def test_a_repeat_is_replayed_without_calling_the_model(self):
        llm = CachingMLX(self.path)
        first = llm.complete("what is 2+2", 50)
        second = llm.complete("what is 2+2", 50)
        self.assertEqual(len(self.fake.calls), 1)
        self.assertEqual((llm.hits, llm.misses), (1, 1))
        self.assertFalse(first["cached"])
        self.assertTrue(second["cached"])
        self.assertEqual(second["text"], first["text"])
        self.assertEqual(second["seconds"], 1.25, "replay reports the time measured when the call was first made")

    def test_a_different_budget_or_prompt_is_a_different_call(self):
        llm = CachingMLX(self.path)
        llm.complete("same prompt", 50)
        llm.complete("same prompt", 60)
        llm.complete("other prompt", 50)
        self.assertEqual(len(self.fake.calls), 3)
        self.assertEqual(llm.hits, 0)

    def test_the_default_budget_is_part_of_the_key(self):
        llm = CachingMLX(self.path, max_tokens=900)
        llm.complete("p")
        llm.complete("p", 900)
        self.assertEqual(len(self.fake.calls), 1)

    def test_the_cache_survives_a_restart_and_the_folder_is_created(self):
        CachingMLX(self.path).complete("remember me", 10)
        again = CachingMLX(self.path)
        out = again.complete("remember me", 10)
        self.assertTrue(out["cached"])
        self.assertEqual(len(self.fake.calls), 1)

    def test_every_record_is_audit_ready(self):
        CachingMLX(self.path).complete("a prompt that is long " * 20, 30)
        record = json.loads(Path(self.path).read_text().splitlines()[0])
        for key in ("key", "model", "max_tokens", "prompt_head", "text", "seconds", "prompt_tokens", "output_tokens", "recorded"):
            self.assertIn(key, record)
        self.assertEqual(len(record["prompt_head"]), 120)
        self.assertEqual(len(record["key"]), 64)

    def test_the_model_name_is_part_of_the_key(self):
        a, b = CachingMLX(self.path, model_id="model-a"), CachingMLX(self.path, model_id="model-b")
        self.assertNotEqual(a._key("p", 10), b._key("p", 10))

    def test_a_half_written_last_line_after_a_crash_does_not_make_the_cache_unreadable(self):
        CachingMLX(self.path).complete("kept", 10)
        with open(self.path, "a", encoding="utf-8") as fh:
            fh.write('{"key": "abc", "text": "cut off in the mid')
        again = CachingMLX(self.path)
        self.assertTrue(again.complete("kept", 10)["cached"])

    def test_the_next_append_after_a_crash_starts_on_its_own_line(self):
        CachingMLX(self.path).complete("first", 10)
        with open(self.path, "a", encoding="utf-8") as fh:
            fh.write('{"key": "abc", "text": "cut off')
        resumed = CachingMLX(self.path)
        self.assertEqual(resumed.skipped_lines, [2])
        resumed.complete("second", 10)
        final = CachingMLX(self.path)
        self.assertTrue(final.complete("first", 10)["cached"])
        self.assertTrue(final.complete("second", 10)["cached"])


if __name__ == "__main__":
    unittest.main()
