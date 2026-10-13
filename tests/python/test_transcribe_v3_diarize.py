"""Tests for the thin model wrapper in transcribe_v3.py (diarize and friends) and for finalize() in
transcribe_server.py, with a fake Sortformer: no weights, no mlx, nothing touches the GPU.

Both scripts import mlx at module level, so mlx / mlx_audio / sounddevice are replaced by tiny numpy
stand-ins while this module runs (setUpModule / tearDownModule restore sys.modules).

Run from the app folder:  python3.11 -m unittest discover -s tests/python
"""

import ast
import contextlib
import importlib
import io
import json
import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import numpy as np

PYTHON_DIR = Path(__file__).resolve().parents[2] / "src-tauri" / "resources" / "python"
sys.path.insert(0, str(PYTHON_DIR))

import diar_stream as ds  # noqa: E402

SR, HOP, SUB = 16000, 160, 8
N_SPEAKERS = 4
FRAME_S = ds.frame_seconds(HOP, SUB, SR)

STUBBED = ["mlx", "mlx.core", "mlx_audio", "mlx_audio.vad", "mlx_audio.vad.models",
           "mlx_audio.vad.models.sortformer", "mlx_audio.vad.models.sortformer.sortformer",
           "sounddevice", "transcribe_v3", "transcribe_server"]
_saved = {}
tv = ts = None
MEL_CALLS = []


def fake_extract_mel_features(waveform, sample_rate, n_fft, hop_length, win_length, n_mels,
                              preemphasis_coeff, normalize, pad_to):
    """(1, n_mels, T) where every mel bin of frame t holds t: a slice tells which global frames it is."""
    MEL_CALLS.append({"normalize": normalize, "pad_to": pad_to, "n_mels": n_mels, "samples": len(waveform)})
    frames = len(waveform) // hop_length + 1
    return np.tile(np.arange(frames, dtype=np.float32), (1, n_mels, 1))


def setUpModule():
    global tv, ts
    for name in STUBBED:
        _saved[name] = sys.modules.get(name)

    def module(name, **attrs):
        mod = types.ModuleType(name)
        mod.__path__ = []
        mod.__dict__.update(attrs)
        sys.modules[name] = mod
        return mod

    core = module("mlx.core", array=lambda data, *a, **k: np.array(data), eval=lambda *a, **k: None)
    module("mlx", core=core)
    sortformer = module("mlx_audio.vad.models.sortformer.sortformer", extract_mel_features=fake_extract_mel_features)
    pkg = module("mlx_audio.vad.models.sortformer", sortformer=sortformer)
    models = module("mlx_audio.vad.models", sortformer=pkg)
    vad = module("mlx_audio.vad", models=models)
    module("mlx_audio", vad=vad)
    module("sounddevice")
    sys.modules.pop("transcribe_v3", None)
    sys.modules.pop("transcribe_server", None)
    tv = importlib.import_module("transcribe_v3")
    ts = importlib.import_module("transcribe_server")


def tearDownModule():
    for name, mod in _saved.items():
        if mod is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = mod


def n_emb_for(n_samples):
    return -(-ds.expected_mel_frames(n_samples, HOP) // SUB)


def sticky_truth(n_emb, seed=5):
    """Frame probabilities with speakers switching on and off (float32, 0.9 on / 0.1 off)."""
    flips = np.random.default_rng(seed).random((n_emb, N_SPEAKERS)) < 0.05
    return np.where(np.cumsum(flips, axis=0) % 2 == 1, 0.9, 0.1).astype(np.float32)


class FakeDiar:
    """Stands in for the Sortformer model: the same attributes and calls the wrapper uses.

    The 'model' predicts `truth` for each global diarization frame, which it derives from the frame
    numbers carried by the features (see fake_extract_mel_features), so a chunk that is cut or placed
    wrongly gives wrong probabilities. Embeddings are the global index of their first mel frame / 8.
    """

    def __init__(self, truth=None, use_aosc=True, right_context=1, oneshot_segments=()):
        self.config = SimpleNamespace(
            modules_config=SimpleNamespace(use_aosc=use_aosc, spkcache_len=188, fifo_len=0,
                                           chunk_right_context=right_context),
            fc_encoder_config=SimpleNamespace(subsampling_factor=SUB))
        self._processor_config = SimpleNamespace(sampling_rate=SR, n_fft=512, hop_length=HOP, win_length=400,
                                                 feature_size=4, preemphasis=0.97)
        self.fc_encoder = SimpleNamespace(pre_encode=self._pre_encode)
        self.truth = truth
        self.oneshot_segments = list(oneshot_segments)
        self.calls = []

    def log(self, kind):
        return [c for c in self.calls if c[0] == kind]

    def _load_audio(self, audio, sample_rate):
        return np.asarray(audio, dtype=np.float32), sample_rate

    def init_streaming_state(self):
        self.calls.append(("init",))
        return {"steps": 0, "compressions": 0}

    def _pre_encode(self, feat, lengths):
        frames = feat.shape[2]
        assert int(lengths[0]) == frames
        first_mel = feat[0, 0, ::SUB]
        self.calls.append(("pre_encode", int(feat[0, 0, 0]), frames))
        return (first_mel // SUB).astype(np.float32)[None, :, None], np.array([-(-frames // SUB)])

    def streaming_step(self, chunk_feat, chunk_len, state, right_context_embs=None):
        assert state["compressions"] == state["steps"], "state must be compressed after every step"
        frames = chunk_feat.shape[2]
        assert int(chunk_len[0]) == frames
        first_mel = int(chunk_feat[0, 0, 0])
        context = None if right_context_embs is None else right_context_embs[0, :, 0].astype(int).tolist()
        self.calls.append(("step", first_mel, frames, context))
        emb_start = first_mel // SUB
        preds = self.truth[emb_start: emb_start + -(-frames // SUB)].copy()
        return preds, dict(state, steps=state["steps"] + 1)

    def _maybe_compress_state(self, state, spkcache_max, fifo_max, mc):
        self.calls.append(("compress", spkcache_max, fifo_max))
        return dict(state, compressions=state["compressions"] + 1)

    def generate(self, audio, threshold=0.5):
        self.calls.append(("generate", len(audio), threshold))
        return SimpleNamespace(segments=[SimpleNamespace(start=s, end=e, speaker=k)
                                         for s, e, k in self.oneshot_segments])


class FakeOneShotOnlyDiar:
    """A model without streaming support (e.g. an older Sortformer)."""

    def __init__(self):
        self.config = SimpleNamespace(modules_config=SimpleNamespace(use_aosc=False))
        self.calls = []

    def generate(self, audio, threshold=0.5):
        self.calls.append(("generate", len(audio), threshold))
        return SimpleNamespace(segments=[SimpleNamespace(start=1.0, end=2.0, speaker=0)])


def long_audio(seconds):
    return np.zeros(int(round(seconds * SR)), dtype=np.float32)


def streaming_fake(seconds, **kw):
    audio = long_audio(seconds)
    return FakeDiar(truth=sticky_truth(n_emb_for(len(audio))), **kw), audio


class StreamingWrapperTest(unittest.TestCase):
    def test_long_recording_is_streamed_and_gives_the_segments_of_the_probabilities(self):
        diar, audio = streaming_fake(130.0)
        segments, info = tv.diarize_with_info(diar, audio)
        self.assertEqual(info["mode"], "stream")
        self.assertAlmostEqual(info["duration_s"], 130.0)
        self.assertEqual(segments, ds.probs_to_segments(diar.truth, 0.5, FRAME_S))
        self.assertGreater(len(segments), 10)
        self.assertEqual(diar.log("generate"), [])

    def test_the_chunks_and_right_contexts_are_the_planned_ones(self):
        diar, audio = streaming_fake(130.0)
        tv.diarize(diar, audio)
        total_mel = ds.expected_mel_frames(len(audio), HOP)
        plan = ds.plan_chunks(total_mel, 496, SUB, 1)
        steps = diar.log("step")
        self.assertEqual(len(steps), len(plan))
        for step, ch in zip(steps, plan):
            _, first_mel, frames, context = step
            self.assertEqual((first_mel, frames), (ch.mel_start, ch.mel_len))
            self.assertEqual(context, list(range(ch.rc_start, ch.rc_end)) if ch.has_right_context else None)
        self.assertIsNone(steps[-1][3])

    def test_stream_probabilities_are_float32_chunks_that_add_up_to_the_recording(self):
        diar, audio = streaming_fake(130.0)
        chunks = list(tv.stream_probabilities(diar, audio))
        self.assertTrue(all(c.dtype == np.float32 and c.ndim == 2 and c.shape[1] == N_SPEAKERS for c in chunks))
        np.testing.assert_array_equal(np.concatenate(chunks), diar.truth)
        self.assertEqual([len(c) for c in chunks[:-1]], [62] * (len(chunks) - 1))

    def test_state_is_compressed_after_every_step_with_the_configured_sizes(self):
        diar, audio = streaming_fake(130.0)
        tv.diarize(diar, audio)
        kinds = [c[0] for c in diar.calls if c[0] in ("step", "compress")]
        self.assertEqual(kinds, ["step", "compress"] * len(diar.log("step")))
        self.assertEqual({c[1:] for c in diar.log("compress")}, {(188, 188)})
        self.assertEqual(len(diar.log("init")), 1)

    def test_preencode_runs_block_wise(self):
        diar, audio = streaming_fake(600.0)
        tv.diarize(diar, audio)
        total_mel = ds.expected_mel_frames(len(audio), HOP)
        plan = ds.plan_chunks(total_mel, 496, SUB, 1)
        blocks = ds.PreEncodeBlocks(total_mel, SUB)
        for ch in plan:
            if ch.has_right_context:
                blocks.request(ch.rc_start, ch.rc_end)
        pre = diar.log("pre_encode")
        self.assertEqual(len(pre), blocks.blocks_started)
        self.assertGreaterEqual(len(pre), 9)
        longest = max(frames for _, _, frames in pre)
        self.assertLessEqual(longest, (ds.PREENCODE_BLOCK_FRAMES + 2 * ds.PREENCODE_MARGIN_FRAMES) * SUB)
        self.assertLess(longest, total_mel // 5)                       # never the whole recording
        self.assertTrue(all(first_mel % SUB == 0 for _, first_mel, _ in pre))

    def test_features_use_the_streaming_settings_of_the_library(self):
        MEL_CALLS.clear()
        diar, audio = streaming_fake(130.0)
        tv.diarize(diar, audio)
        self.assertEqual(MEL_CALLS, [{"normalize": None, "pad_to": 0, "n_mels": 4, "samples": len(audio)}])

    def test_exactly_120_seconds_streams(self):
        diar, audio = streaming_fake(120.0)
        _, info = tv.diarize_with_info(diar, audio)
        self.assertEqual(info["mode"], "stream")
        self.assertEqual(len(diar.log("step")), 25)

    def test_threshold_reaches_the_segments(self):
        diar, audio = streaming_fake(130.0)
        diar.truth[:] = 0.1
        diar.truth[10:20, 0] = 0.4
        self.assertEqual(tv.diarize(diar, audio), [])
        self.assertEqual(tv.diarize(diar, audio, threshold=0.3), [(10 * FRAME_S, 20 * FRAME_S, 0)])

    def test_speakers_are_the_model_slots_as_plain_ints(self):
        diar, audio = streaming_fake(130.0)
        diar.truth[:] = 0.0
        diar.truth[50:60, 3] = 0.9
        segments = tv.diarize(diar, audio)
        self.assertEqual(segments, [(50 * FRAME_S, 60 * FRAME_S, 3)])
        self.assertIs(type(segments[0][2]), int)
        json.dumps(segments)

    def test_a_run_over_a_chunk_join_is_one_segment(self):
        diar, audio = streaming_fake(130.0)
        diar.truth[:] = 0.0
        diar.truth[55:70, 1] = 0.9                                     # chunk 0 ends at frame 62
        self.assertEqual(tv.diarize(diar, audio), [(55 * FRAME_S, 70 * FRAME_S, 1)])

    def test_failures_while_streaming_are_not_hidden_by_a_fallback_to_one_shot(self):
        diar, audio = streaming_fake(130.0)
        diar.streaming_step = mock.Mock(side_effect=RuntimeError("out of memory"))
        with self.assertRaisesRegex(RuntimeError, "out of memory"):
            tv.diarize(diar, audio)
        self.assertEqual(diar.log("generate"), [])


class ModeSelectionTest(unittest.TestCase):
    ONESHOT = [(0.9, 2.6, 1), (4.8, 6.5, 2)]

    def test_short_recording_uses_the_library_call_unchanged(self):
        diar, audio = streaming_fake(60.0, oneshot_segments=self.ONESHOT)
        segments, info = tv.diarize_with_info(diar, audio)
        self.assertEqual(info["mode"], "oneshot")
        self.assertEqual(segments, self.ONESHOT)
        self.assertEqual(diar.log("generate"), [("generate", len(audio), 0.5)])
        self.assertEqual(diar.log("step"), [])
        self.assertEqual(diar.log("pre_encode"), [])

    def test_just_below_120_seconds_is_one_shot(self):
        audio = np.zeros(120 * SR - 1, dtype=np.float32)
        diar = FakeDiar(truth=sticky_truth(n_emb_for(len(audio))), oneshot_segments=self.ONESHOT)
        self.assertEqual(tv.diarize_with_info(diar, audio)[1]["mode"], "oneshot")

    def test_one_shot_threshold_is_passed_through(self):
        diar, audio = streaming_fake(30.0, oneshot_segments=self.ONESHOT)
        tv.diarize(diar, audio, threshold=0.3)
        self.assertEqual(diar.log("generate"), [("generate", len(audio), 0.3)])

    def test_default_threshold_is_the_one_the_app_always_used(self):
        self.assertEqual(tv.DIAR_THRESHOLD, 0.5)

    def test_modes_can_be_forced(self):
        diar, audio = streaming_fake(20.0, oneshot_segments=self.ONESHOT)
        segments, info = tv.diarize_with_info(diar, audio, mode="stream")
        self.assertEqual(info["mode"], "stream")
        self.assertEqual(segments, ds.probs_to_segments(diar.truth, 0.5, FRAME_S))
        self.assertEqual(diar.log("generate"), [])
        diar, audio = streaming_fake(130.0, oneshot_segments=self.ONESHOT)
        segments, info = tv.diarize_with_info(diar, audio, mode="oneshot")
        self.assertEqual((info["mode"], segments), ("oneshot", self.ONESHOT))
        self.assertEqual(diar.log("step"), [])

    def test_unknown_mode_is_an_error(self):
        diar, audio = streaming_fake(20.0)
        with self.assertRaises(ValueError):
            tv.diarize(diar, audio, mode="turbo")

    def test_empty_audio_makes_no_model_call(self):
        diar = FakeDiar(truth=np.zeros((0, N_SPEAKERS), np.float32))
        segments, info = tv.diarize_with_info(diar, np.zeros(0, np.float32))
        self.assertEqual(segments, [])
        self.assertEqual(info["mode"], "none")
        self.assertEqual(diar.calls, [])

    def test_a_tenth_of_a_second_streams_when_forced(self):
        diar, audio = streaming_fake(0.1)
        self.assertEqual(len(audio), 1600)
        self.assertEqual(tv.diarize(diar, audio, mode="stream"), ds.probs_to_segments(diar.truth, 0.5, FRAME_S))
        self.assertEqual(len(diar.log("step")), 1)
        self.assertEqual(diar.log("pre_encode"), [])

    def test_a_model_without_streaming_falls_back_to_one_shot_and_says_so(self):
        diar = FakeOneShotOnlyDiar()
        segments, info = tv.diarize_with_info(diar, long_audio(130.0))
        self.assertEqual(segments, [(1.0, 2.0, 0)])
        self.assertEqual(info["mode"], "oneshot")
        self.assertIn("streaming", info["note"])

    def test_forcing_streaming_on_a_model_without_it_is_an_error(self):
        with self.assertRaises(RuntimeError):
            tv.diarize(FakeOneShotOnlyDiar(), long_audio(130.0), mode="stream")

    def test_model_without_aosc_is_not_streamed(self):
        diar, audio = streaming_fake(130.0, use_aosc=False, oneshot_segments=self.ONESHOT)
        segments, info = tv.diarize_with_info(diar, audio)
        self.assertEqual((info["mode"], segments), ("oneshot", self.ONESHOT))


def fake_stt_result():
    def tok(text, start, end):
        return SimpleNamespace(text=text, start=start, end=end)

    return SimpleNamespace(sentences=[
        SimpleNamespace(tokens=[tok(" hello", 1.0, 1.4), tok(" there", 1.5, 2.0), tok(".", 2.0, 2.0)]),
        SimpleNamespace(tokens=[tok(" good", 5.0, 5.4), tok(" morning", 5.5, 6.0)]),
    ])


class FakeStt:
    def __init__(self):
        self.calls = []

    def generate(self, audio, chunk_duration=None):
        self.calls.append((len(audio), chunk_duration))
        return fake_stt_result()


def blocks_of(seconds):
    return [np.zeros(1600, dtype=np.float32) for _ in range(int(round(seconds * 10)))]


class FinalizeProtocolTest(unittest.TestCase):
    """finalize() keeps its JSON event protocol and output shape on both diarization paths."""

    EXPECTED_TURNS = [{"t0": 1.0, "t1": 2.0, "speaker": "Speaker 1", "text": "hello there."},
                      {"t0": 5.0, "t1": 6.0, "speaker": "Speaker 2", "text": "good morning"}]

    def run_finalize(self, seconds):
        n = int(round(seconds * SR))
        truth = np.zeros((n_emb_for(n), N_SPEAKERS), np.float32)
        truth[12:32, 1] = 0.9
        truth[60:82, 2] = 0.9
        diar = FakeDiar(truth=truth, oneshot_segments=[(12 * FRAME_S, 32 * FRAME_S, 1), (60 * FRAME_S, 82 * FRAME_S, 2)])
        stt, events = FakeStt(), []
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(ts, "emit", side_effect=events.append), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            ts.finalize(stt, diar, blocks_of(seconds))
        return events, diar, stt, out.getvalue(), err.getvalue()

    def check_final_event(self, events):
        self.assertEqual(len(events), 1)
        final = events[0]
        self.assertEqual(set(final), {"type", "turns", "speakers", "sessionId", "duration"})
        self.assertEqual(final["type"], "final")
        self.assertEqual(final["turns"], self.EXPECTED_TURNS)
        for turn in final["turns"]:
            self.assertEqual(set(turn), {"t0", "t1", "speaker", "text"})
        self.assertEqual(final["speakers"], [{"id": "Speaker 1", "suggested": None},
                                             {"id": "Speaker 2", "suggested": None}])
        self.assertEqual(final["sessionId"], "")
        json.dumps(final)                                              # emit() serialises it

    def test_streamed_recording(self):
        events, diar, stt, out, err = self.run_finalize(130.0)
        self.check_final_event(events)
        self.assertEqual(events[0]["duration"], 130.0)
        self.assertEqual(len(diar.log("step")), 27)                    # 130 s = 13001 mel frames: 26 x 496 + 105
        self.assertEqual(diar.log("generate"), [])
        self.assertEqual(stt.calls, [(130 * SR, 120.0)])

    def test_one_shot_recording(self):
        events, diar, stt, out, err = self.run_finalize(30.0)
        self.check_final_event(events)
        self.assertEqual(events[0]["duration"], 30.0)
        self.assertEqual(len(diar.log("generate")), 1)
        self.assertEqual(diar.log("step"), [])

    def test_both_paths_give_the_same_final_event(self):
        streamed = self.run_finalize(130.0)[0][0]
        short = self.run_finalize(30.0)[0][0]
        self.assertEqual({k: v for k, v in streamed.items() if k != "duration"},
                         {k: v for k, v in short.items() if k != "duration"})

    def test_nothing_goes_to_stdout_or_stderr(self):
        for seconds in (30.0, 130.0):
            _, _, _, out, err = self.run_finalize(seconds)
            self.assertEqual((out, err), ("", ""), seconds)            # stdout is the protocol, stderr the status

    def test_empty_recording(self):
        events = []
        with mock.patch.object(ts, "emit", side_effect=events.append):
            ts.finalize(FakeStt(), FakeDiar(), [])
        self.assertEqual(events, [{"type": "final", "turns": [], "speakers": [], "sessionId": "", "duration": 0}])


class NoOneShotCallLeftTest(unittest.TestCase):
    def test_only_diarize_oneshot_calls_generate_on_the_diarization_model(self):
        found = set()
        for path in sorted(PYTHON_DIR.glob("*.py")):
            tree = ast.parse(path.read_text())
            owners = {}
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    for sub in ast.walk(node):
                        owners.setdefault(id(sub), node.name)          # the outermost enclosing function
            for node in ast.walk(tree):
                if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                        and node.func.attr == "generate"
                        and isinstance(node.func.value, ast.Name) and node.func.value.id.startswith("diar")):
                    found.add((path.name, owners.get(id(node), "<module>")))
        self.assertEqual(found, {("transcribe_v3.py", "diarize_oneshot")})


if __name__ == "__main__":
    unittest.main()
