"""Tests for the windowed extractor: long meetings are read in overlapping windows and the candidates are merged."""
import unittest

from memoria_engine.pipeline import AttributeSpec, Candidate, Meeting, MeetingContext, ObjectSpec, Registry, Turn, make_policy, Pipeline
from memoria_engine.windowed import WindowedExtractor


def meeting(n_turns: int, text_len: int = 100, first_index: int = 0) -> Meeting:
    turns = tuple(Turn(first_index + i, "pm", 20.0 * i, f"turn {i} " + "x" * text_len) for i in range(n_turns))
    return Meeting("m1", 1_000_000, 2_000_000, turns)


def registry() -> Registry:
    spec = ObjectSpec("budget", "decision", "Budget", (AttributeSpec("amount", "number"),))
    return Registry({"budget": spec}, {})


class FakeInner:
    """Finds a candidate in every window it is shown: one per turn whose text contains the marker 'decide'."""

    name = "fake"

    def __init__(self, tokens=(100, 20), clean=True):
        self.seen = []
        self.last_stats = {}
        self.tokens, self.clean = tokens, clean

    def extract(self, ctx):
        self.seen.append(ctx.meeting)
        out = []
        for t in ctx.meeting.turns:
            if "decide" in t.text:
                out.append(Candidate("budget", "amount", 5000, f"decide {t.index}", t.index, None, 0.8))
        self.last_stats = {"prompt_tokens": self.tokens[0], "output_tokens": self.tokens[1], "llm_seconds": 1.5, "parsed_cleanly": self.clean}
        return out


class WindowsTest(unittest.TestCase):
    def test_short_meeting_is_one_window(self):
        w = WindowedExtractor(None, window_chars=7000)
        self.assertEqual(w.windows(meeting(5)), [[0, 1, 2, 3, 4]])

    def test_empty_meeting_has_no_windows(self):
        self.assertEqual(WindowedExtractor(None).windows(meeting(0)), [])

    def test_windows_respect_the_size_and_cover_every_turn(self):
        m = meeting(60, text_len=200)
        w = WindowedExtractor(None, window_chars=2000, overlap_turns=3)
        windows = w.windows(m)
        self.assertGreater(len(windows), 3)
        covered = sorted({i for win in windows for i in win})
        self.assertEqual(covered, list(range(60)))
        for win in windows:
            size = sum(len(m.turns[i].text) + 12 for i in win)
            self.assertLessEqual(size, 2000)

    def test_consecutive_windows_overlap_by_the_configured_number_of_turns(self):
        m = meeting(40, text_len=300)
        windows = WindowedExtractor(None, window_chars=2500, overlap_turns=4).windows(m)
        self.assertTrue(all(len(w) > 5 for w in windows[:-1]))
        for a, b in zip(windows, windows[1:]):
            self.assertEqual(len(set(a) & set(b)), 4)
            self.assertGreater(b[0], a[0])

    def test_no_overlap_when_zero(self):
        windows = WindowedExtractor(None, window_chars=1500, overlap_turns=0).windows(meeting(30, text_len=300))
        for a, b in zip(windows, windows[1:]):
            self.assertEqual(set(a) & set(b), set())

    def test_a_turn_longer_than_the_window_gets_a_window_of_its_own_and_progress_continues(self):
        turns = (Turn(0, "pm", 0.0, "a" * 50), Turn(1, "pm", 1.0, "b" * 9000), Turn(2, "pm", 2.0, "c" * 50))
        m = Meeting("m1", 0, 0, turns)
        windows = WindowedExtractor(None, window_chars=1000, overlap_turns=6).windows(m)
        self.assertIn([1], windows)
        self.assertEqual(sorted({i for w in windows for i in w}), [0, 1, 2])
        self.assertLess(len(windows), 10, "no runaway loop")

    def test_overlap_larger_than_the_window_still_terminates(self):
        windows = WindowedExtractor(None, window_chars=700, overlap_turns=50).windows(meeting(25, text_len=300))
        self.assertEqual(sorted({i for w in windows for i in w}), list(range(25)))
        starts = [w[0] for w in windows]
        self.assertEqual(starts, sorted(set(starts)), "window starts strictly increase")


class ExtractTest(unittest.TestCase):
    def ctx(self, m):
        return MeetingContext(m, registry(), {})

    def test_turn_indexes_are_kept_so_quotes_still_ground(self):
        inner = FakeInner()
        m = meeting(30, text_len=300, first_index=100)
        WindowedExtractor(inner, window_chars=1500, overlap_turns=2).extract(self.ctx(m))
        shown = [t.index for sub in inner.seen for t in sub.turns]
        self.assertTrue(all(100 <= i < 130 for i in shown))
        self.assertEqual(shown[0], 100)

    def test_candidates_from_all_windows_are_merged_in_turn_order(self):
        turns = tuple(Turn(i, "pm", float(i), ("decide " if i in (2, 25, 55) else "talk ") + "y" * 300) for i in range(60))
        inner = FakeInner()
        out = WindowedExtractor(inner, window_chars=2000, overlap_turns=3).extract(self.ctx(Meeting("m1", 0, 0, turns)))
        self.assertEqual([c.turn for c in out], [2, 25, 55])
        self.assertGreater(len(inner.seen), 2)

    def test_a_repeat_inside_the_overlap_is_dropped_and_the_more_confident_copy_is_kept(self):
        class Twice(FakeInner):
            def extract(self, ctx):
                out = super().extract(ctx)
                for c in out:
                    c.confidence = 0.9 if ctx.meeting.turns[0].index > 0 else 0.5
                return out

        turns = tuple(Turn(i, "pm", float(i), ("decide " if i == 10 else "talk ") + "z" * 300) for i in range(20))
        inner = Twice()
        out = WindowedExtractor(inner, window_chars=1500, overlap_turns=8).extract(self.ctx(Meeting("m1", 0, 0, turns)))
        decided = [c for c in out if c.turn == 10]
        self.assertEqual(len(decided), 1)
        self.assertEqual(decided[0].confidence, 0.9)

    def test_the_same_value_far_apart_is_kept_twice(self):
        turns = tuple(Turn(i, "pm", float(i), ("decide " if i in (2, 50) else "talk ") + "w" * 300) for i in range(60))
        out = WindowedExtractor(FakeInner(), window_chars=2000, overlap_turns=3, dedupe_gap=12).extract(self.ctx(Meeting("m1", 0, 0, turns)))
        self.assertEqual([c.turn for c in out], [2, 50])

    def test_stats_add_up_over_windows(self):
        inner = FakeInner(tokens=(100, 20), clean=True)
        ext = WindowedExtractor(inner, window_chars=1500, overlap_turns=2)
        ext.extract(self.ctx(meeting(30, text_len=300)))
        n = len(inner.seen)
        self.assertEqual(ext.last_stats["windows"], n)
        self.assertEqual(ext.last_stats["prompt_tokens"], 100 * n)
        self.assertEqual(ext.last_stats["output_tokens"], 20 * n)
        self.assertAlmostEqual(ext.last_stats["llm_seconds"], 1.5 * n, places=2)
        self.assertTrue(ext.last_stats["parsed_cleanly"])

    def test_one_unclean_window_marks_the_meeting_unclean(self):
        ext = WindowedExtractor(FakeInner(clean=False), window_chars=1500)
        ext.extract(self.ctx(meeting(30, text_len=300)))
        self.assertFalse(ext.last_stats["parsed_cleanly"])

    def test_name_mentions_the_inner_extractor(self):
        self.assertEqual(WindowedExtractor(FakeInner()).name, "fake+windows")

    def test_empty_meeting_gives_no_candidates_and_zero_windows(self):
        ext = WindowedExtractor(FakeInner())
        self.assertEqual(ext.extract(self.ctx(meeting(0))), [])
        self.assertEqual(ext.last_stats["windows"], 0)


class EndToEndTest(unittest.TestCase):
    def test_a_decision_late_in_a_long_meeting_reaches_the_ledger_with_its_turn(self):
        filler = [Turn(i, "pm", float(i), "background talk " + "q" * 400) for i in range(40)]
        decision = Turn(40, "pm", 40.0, "Fine, decide the budget now: 5000 ringgit.")
        m = Meeting("m1", 1_700_000_000_000_000, 1_700_000_100_000_000, tuple(filler + [decision]))

        class Quoting(FakeInner):
            def extract(self, ctx):
                return [Candidate("budget", "amount", 5000, "decide the budget now: 5000 ringgit", t.index, None, 0.9)
                        for t in ctx.meeting.turns if "decide the budget" in t.text]

        pipe = Pipeline(registry(), WindowedExtractor(Quoting(), window_chars=2500, overlap_turns=3), make_policy("immediate"))
        result = pipe.ingest(m)
        applied = [d for d in result.dispositions if d.status == "applied"]
        self.assertEqual(len(applied), 1)
        self.assertEqual(applied[0].turn, 40)
        self.assertEqual(pipe.ledger.current("budget", "amount").value, 5000)
        self.assertEqual(pipe.ledger.check_invariants(), [])


if __name__ == "__main__":
    unittest.main()
