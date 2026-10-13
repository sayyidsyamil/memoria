"""Tests for the model-free part of the post-recording diarization (diar_stream.py).

numpy only: no model, no mlx import, nothing touches the GPU.

Run from the app folder:  python3.11 -m unittest discover -s tests/python
"""

import ast
import json
import subprocess
import sys
import unittest
from pathlib import Path

import numpy as np

PYTHON_DIR = Path(__file__).resolve().parents[2] / "src-tauri" / "resources" / "python"
sys.path.insert(0, str(PYTHON_DIR))

import diar_stream as ds  # noqa: E402

# diar_streaming_sortformer_4spk-v2.1: 16 kHz, hop 160, subsampling 8 (80 ms frames), 1 right-context frame
SR, HOP, SUB, RC = 16000, 160, 8, 1
FRAME_S = ds.frame_seconds(HOP, SUB, SR)
CHUNK_MEL = ds.chunk_mel_frames(ds.STREAM_CHUNK_SECONDS, SR, HOP, SUB)
TRANSFORMER_POSITIONS = 1500


def conv_len(n):
    """Frames after the model's three stride-2 convolutions (floor((L - 1) / 2) + 1 each)."""
    for _ in range(3):
        n = (n - 1) // 2 + 1
    return n


def mel_frames(seconds):
    return ds.expected_mel_frames(round(seconds * SR), HOP)


def plan_for(seconds, right_context=RC):
    total = mel_frames(seconds)
    return total, ds.plan_chunks(total, CHUNK_MEL, SUB, right_context)


def sticky_probs(rng, n, k=4):
    """Speakers switching on and off with runs of ~12 frames (0.9 when on, 0.1 when off)."""
    flips = rng.random((n, k)) < 0.08
    return np.where(np.cumsum(flips, axis=0) % 2 == 1, 0.9, 0.1)


def run_chunks(pieces, threshold=0.5):
    acc = ds.SegmentAccumulator(threshold, FRAME_S)
    emitted = []
    for piece in pieces:
        emitted.extend(acc.feed(piece))
    return acc, emitted, acc.finish()


def column(n, active, spk=0, k=4):
    """(n, k) probabilities with `spk` active on the frame ranges `active`, everything else silent."""
    p = np.zeros((n, k))
    for a, b in active:
        p[a:b, spk] = 0.9
    return p


class ConfigurationTest(unittest.TestCase):
    def test_five_second_chunks_are_496_mel_frames(self):
        self.assertEqual(CHUNK_MEL, 496)          # round(62.5) = 62 frames of 8: 4.96 s, as the library does
        self.assertEqual(CHUNK_MEL // SUB, 62)

    def test_chunk_never_shorter_than_one_subsampled_frame(self):
        self.assertEqual(ds.chunk_mel_frames(0.001, SR, HOP, SUB), SUB)
        self.assertEqual(ds.chunk_mel_frames(10.0, SR, HOP, SUB), 1000)

    def test_frame_duration_is_80_ms(self):
        self.assertEqual(FRAME_S, 0.08)

    def test_mel_frames_of_a_centred_stft(self):
        self.assertEqual(ds.expected_mel_frames(0, HOP), 0)
        self.assertEqual(ds.expected_mel_frames(1, HOP), 1)
        self.assertEqual(ds.expected_mel_frames(159, HOP), 1)
        self.assertEqual(ds.expected_mel_frames(160, HOP), 2)
        self.assertEqual(ds.expected_mel_frames(120 * SR, HOP), 12001)

    def test_cache_sizes_follow_the_config_and_fall_back_like_the_library(self):
        self.assertEqual(ds.cache_sizes(188, 0), (188, 188))      # the v2.1 config: spkcache_len 188, fifo_len 0
        self.assertEqual(ds.cache_sizes(188, 40), (188, 40))
        self.assertEqual(ds.cache_sizes(100, 0), (100, 188))

    def test_speaker_labels_are_the_apps(self):
        self.assertEqual(ds.speaker_label(0), "Speaker 0")
        self.assertEqual(ds.speaker_label(3), "Speaker 3")
        self.assertEqual(ds.speaker_label(np.int64(2)), "Speaker 2")


class ChooseModeTest(unittest.TestCase):
    def test_short_recordings_use_the_one_shot_call(self):
        for seconds in (0.0, 0.5, 30.0, 60.0, 119.9, 119.99):
            self.assertEqual(ds.choose_mode(seconds), "oneshot", seconds)

    def test_two_minutes_and_longer_stream(self):
        for seconds in (120.0, 120.0001, 120.1, 180.0, 14 * 60.0, 2 * 3600.0):
            self.assertEqual(ds.choose_mode(seconds), "stream", seconds)

    def test_boundary_is_where_the_one_shot_call_stops_fitting_the_model(self):
        def oneshot_frames(n_samples):      # frames the library's one-shot call feeds the transformer
            mel = ds.expected_mel_frames(n_samples, HOP)
            padded = -(-mel // 16) * 16     # extract_mel_features pads to a multiple of 16 by default
            return -(-padded // SUB)

        just_below, exactly = 120 * SR - 1, 120 * SR
        self.assertEqual(oneshot_frames(just_below), TRANSFORMER_POSITIONS)
        self.assertEqual(ds.choose_mode(just_below / SR), "oneshot")
        self.assertEqual(oneshot_frames(exactly), TRANSFORMER_POSITIONS + 2)
        self.assertEqual(ds.choose_mode(exactly / SR), "stream")

    def test_a_mode_can_be_forced(self):
        self.assertEqual(ds.choose_mode(5.0, "stream"), "stream")
        self.assertEqual(ds.choose_mode(7200.0, "oneshot"), "oneshot")
        self.assertEqual(ds.choose_mode(7200.0, "auto"), "stream")

    def test_unknown_mode_is_an_error(self):
        with self.assertRaises(ValueError):
            ds.choose_mode(10.0, "fast")

    def test_threshold_is_adjustable(self):
        self.assertEqual(ds.choose_mode(60.0, stream_min_s=45.0), "stream")
        self.assertEqual(ds.choose_mode(44.9, stream_min_s=45.0), "oneshot")


class PlanChunksTest(unittest.TestCase):
    def assert_plan_ok(self, total_mel, chunks, right_context=RC):
        if total_mel == 0:
            self.assertEqual(chunks, [])
            return
        n_emb_total = -(-total_mel // SUB)
        self.assertEqual(chunks[0].mel_start, 0)
        self.assertEqual(chunks[-1].mel_end, total_mel)
        for prev, ch in zip(chunks, chunks[1:]):                       # tiles the recording
            self.assertEqual(prev.mel_end, ch.mel_start)
            self.assertEqual(ch.emb_start, prev.emb_start + prev.emb_len)
        for ch in chunks[:-1]:
            self.assertEqual(ch.mel_len, CHUNK_MEL)
        self.assertTrue(1 <= chunks[-1].mel_len <= CHUNK_MEL)
        self.assertEqual(sum(ch.emb_len for ch in chunks), n_emb_total)
        for ch in chunks:
            self.assertEqual(ch.emb_len, conv_len(ch.mel_len))         # what the model yields for the chunk
            self.assertEqual(ch.emb_start * SUB, ch.mel_start)
            self.assertEqual(ch.rc_start, ch.emb_start + ch.emb_len)
            self.assertLessEqual(ch.rc_end - ch.rc_start, right_context)
            self.assertLessEqual(ch.rc_end, n_emb_total)
        for ch in chunks[:-1]:
            self.assertEqual(ch.has_right_context, right_context > 0)
        self.assertFalse(chunks[-1].has_right_context)                 # nothing follows the last chunk

    def test_many_durations(self):
        for seconds in (0.0, 0.01, 0.5, 1.0, 4.95, 4.96, 4.97, 5.0, 5.1, 9.92, 17.0, 59.99, 60.0, 119.99,
                        120.0, 120.04, 121.0, 300.0, 838.8, 14 * 60.0, 3600.0, 2 * 3600.0):
            with self.subTest(seconds=seconds):
                total, chunks = plan_for(seconds)
                self.assert_plan_ok(total, chunks)

    def test_no_audio_means_no_chunks(self):
        self.assertEqual(ds.plan_chunks(0, CHUNK_MEL, SUB, RC), [])
        self.assertEqual(plan_for(0.0)[1], [])

    def test_audio_shorter_than_a_chunk_is_one_chunk_without_right_context(self):
        total, chunks = plan_for(1.0)                                   # 101 mel frames
        self.assertEqual(total, 101)
        self.assertEqual(len(chunks), 1)
        self.assertEqual((chunks[0].mel_start, chunks[0].mel_end), (0, 101))
        self.assertEqual(chunks[0].emb_len, 13)
        self.assertFalse(chunks[0].has_right_context)

    def test_one_sample_of_audio(self):
        chunks = ds.plan_chunks(ds.expected_mel_frames(1, HOP), CHUNK_MEL, SUB, RC)
        self.assertEqual(len(chunks), 1)
        self.assertEqual((chunks[0].mel_len, chunks[0].emb_len), (1, 1))

    def test_exactly_one_chunk_of_audio(self):
        total = 496
        chunks = ds.plan_chunks(total, CHUNK_MEL, SUB, RC)
        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].emb_len, 62)
        self.assertFalse(chunks[0].has_right_context)

    def test_one_frame_over_a_chunk_leaves_a_one_frame_last_chunk(self):
        total = 497                                                     # 4.96 s of audio
        self.assertEqual(mel_frames(4.96), total)
        chunks = ds.plan_chunks(total, CHUNK_MEL, SUB, RC)
        self.assertEqual([c.mel_len for c in chunks], [496, 1])
        self.assertEqual((chunks[0].rc_start, chunks[0].rc_end), (62, 63))
        self.assertEqual(chunks[1].emb_len, 1)

    def test_last_short_chunk(self):
        total, chunks = plan_for(17.0)                                  # 1701 mel frames = 3 x 496 + 213
        self.assertEqual(total, 1701)
        self.assertEqual([c.mel_len for c in chunks], [496, 496, 496, 213])
        self.assertEqual(chunks[-1].emb_len, 27)
        self.assertEqual((chunks[-2].rc_start, chunks[-2].rc_end), (186, 187))
        self.assertFalse(chunks[-1].has_right_context)

    def test_exactly_120_seconds(self):
        total, chunks = plan_for(120.0)
        self.assertEqual(total, 12001)
        self.assertEqual(len(chunks), 25)                               # 24 full chunks + 97 frames
        self.assertEqual(chunks[-1].mel_start, 24 * 496)
        self.assertEqual((chunks[-1].mel_len, chunks[-1].emb_len), (97, 13))
        self.assertEqual(chunks[-1].emb_start + chunks[-1].emb_len, 1501)
        self.assertEqual((chunks[-2].rc_start, chunks[-2].rc_end), (1488, 1489))

    def test_two_hours(self):
        total, chunks = plan_for(2 * 3600.0)
        self.assertEqual(total, 720001)
        self.assertEqual(len(chunks), 1452)
        self.assertEqual((chunks[-1].mel_len, chunks[-1].emb_len), (305, 39))
        self.assertEqual(chunks[-1].emb_start + chunks[-1].emb_len, 90001)

    def test_every_step_is_bounded_whatever_the_length(self):
        # [speaker cache, FIFO, left context, chunk, right context] must fit the transformer's positions
        spkcache, fifo = ds.cache_sizes(188, 0)
        for seconds in (120.0, 3600.0, 4 * 3600.0):
            _, chunks = plan_for(seconds)
            self.assertEqual(max(c.mel_len for c in chunks), CHUNK_MEL)
            step = spkcache + fifo + 1 + max(c.emb_len for c in chunks) + RC
            self.assertEqual(step, 440)
            self.assertLess(step, TRANSFORMER_POSITIONS)

    def test_emb_len_matches_the_models_frame_formula_for_every_length(self):
        for n in range(1, 600):
            self.assertEqual(-(-n // SUB), conv_len(n), n)

    def test_without_right_context(self):
        total, chunks = plan_for(60.0, right_context=0)
        self.assert_plan_ok(total, chunks, right_context=0)
        self.assertFalse(any(c.has_right_context for c in chunks))

    def test_longer_right_context_is_clipped_at_the_end(self):
        total, chunks = plan_for(17.0, right_context=7)
        self.assert_plan_ok(total, chunks, right_context=7)
        self.assertEqual(chunks[-2].rc_end - chunks[-2].rc_start, 7)
        total, chunks = plan_for(5.0, right_context=7)                  # 496 + 5 frames: last chunk has 1 frame
        self.assertEqual([c.emb_len for c in chunks], [62, 1])
        self.assertEqual(chunks[0].rc_end - chunks[0].rc_start, 1)

    def test_invalid_arguments(self):
        with self.assertRaises(ValueError):
            ds.plan_chunks(100, 12, SUB, RC)                            # not a multiple of the subsampling factor
        with self.assertRaises(ValueError):
            ds.plan_chunks(100, 0, SUB, RC)
        with self.assertRaises(ValueError):
            ds.plan_chunks(-1, CHUNK_MEL, SUB, RC)
        with self.assertRaises(ValueError):
            ds.plan_chunks(100, CHUNK_MEL, SUB, -1)


class PreEncodeBlocksTest(unittest.TestCase):
    def serve_all(self, total_mel, chunks):
        """Walk the right-context requests like the wrapper does; a pre-encoded frame is its own index."""
        n_emb_total = -(-total_mel // SUB)
        blocks = ds.PreEncodeBlocks(total_mel, SUB)
        held = None
        for ch in chunks:
            if not ch.has_right_context:
                continue
            block, lo, hi = blocks.request(ch.rc_start, ch.rc_end)
            if block is not None:
                self.assertGreaterEqual(block.emb_start, 0)
                self.assertLessEqual(block.emb_end, n_emb_total)
                self.assertEqual(block.mel_start, block.emb_start * SUB)
                self.assertEqual(block.mel_end, min(total_mel, block.emb_end * SUB))
                held = np.arange(block.emb_start, block.emb_end)
            np.testing.assert_array_equal(held[lo:hi], np.arange(ch.rc_start, ch.rc_end))
        return blocks

    def test_every_request_gets_exactly_the_frames_asked_for(self):
        for seconds in (10.0, 17.0, 60.0, 61.0, 120.0, 600.0, 838.8, 3600.0, 2 * 3600.0):
            with self.subTest(seconds=seconds):
                total, chunks = plan_for(seconds)
                self.serve_all(total, chunks)

    def test_blocks_cover_about_a_minute_each(self):
        total, chunks = plan_for(2 * 3600.0)
        blocks = self.serve_all(total, chunks)
        n_emb_total = -(-total // SUB)
        self.assertLessEqual(blocks.blocks_started, n_emb_total // 700 + 2)    # ~one block per minute of audio
        self.assertLess(blocks.blocks_started * 5, len(chunks))                # not one per chunk

    def test_short_audio_needs_a_single_block(self):
        total, chunks = plan_for(60.0)
        self.assertEqual(self.serve_all(total, chunks).blocks_started, 1)

    def test_a_new_block_starts_a_margin_before_the_request(self):
        blocks = ds.PreEncodeBlocks(100000, SUB)
        block, lo, hi = blocks.request(500, 501)
        self.assertEqual((block.emb_start, lo, hi), (498, 2, 3))
        self.assertEqual(block.emb_end, 500 + ds.PREENCODE_BLOCK_FRAMES + ds.PREENCODE_MARGIN_FRAMES)
        self.assertEqual(block.mel_start, 498 * SUB)

    def test_request_inside_the_block_reuses_it(self):
        blocks = ds.PreEncodeBlocks(100000, SUB)
        blocks.request(500, 501)
        block, lo, hi = blocks.request(562, 563)
        self.assertIsNone(block)
        self.assertEqual((lo, hi), (562 - 498, 563 - 498))
        self.assertEqual(blocks.blocks_started, 1)

    def test_the_first_frame_of_a_block_is_not_served(self):
        blocks = ds.PreEncodeBlocks(100000, SUB)
        blocks.request(500, 501)                                        # block starts at 498
        block, _, _ = blocks.request(498, 499)                          # frame 498 is the edge of the block
        self.assertIsNotNone(block)
        self.assertEqual(block.emb_start, 496)

    def test_request_beyond_the_block_starts_the_next_one(self):
        blocks = ds.PreEncodeBlocks(100000, SUB)
        blocks.request(500, 501)
        block, lo, hi = blocks.request(1250, 1251)                      # block 1 ends at 1252 and holds b <= 1252
        self.assertIsNone(block)
        block, lo, hi = blocks.request(1252, 1253)
        self.assertIsNotNone(block)
        self.assertEqual((block.emb_start, lo, hi), (1250, 2, 3))

    def test_first_block_starts_at_the_beginning(self):
        blocks = ds.PreEncodeBlocks(100000, SUB)
        block, lo, hi = blocks.request(1, 2)
        self.assertEqual((block.emb_start, block.mel_start, lo, hi), (0, 0, 1, 2))
        block, _, _ = blocks.request(0, 1)                              # frame 0 is served from a block starting at 0
        self.assertIsNone(block)

    def test_last_block_is_clipped_to_the_recording(self):
        blocks = ds.PreEncodeBlocks(12001, SUB)                         # 1501 pre-encoded frames, 12001 mel frames
        block, lo, hi = blocks.request(1488, 1489)
        self.assertEqual(block.emb_end, 1501)
        self.assertEqual(block.mel_end, 12001)                          # not 1501 * 8 = 12008
        self.assertEqual(hi - lo, 1)

    def test_request_is_clipped_to_the_end(self):
        blocks = ds.PreEncodeBlocks(12001, SUB)
        block, lo, hi = blocks.request(1500, 1510)
        self.assertEqual(hi - lo, 1)
        self.assertEqual(block.emb_end, 1501)

    def test_bad_requests(self):
        blocks = ds.PreEncodeBlocks(12001, SUB)
        for a, b in ((5, 5), (6, 5), (-1, 3), (1501, 1502), (2000, 2001)):
            with self.subTest(a=a, b=b), self.assertRaises(ValueError):
                blocks.request(a, b)

    def test_no_audio(self):
        blocks = ds.PreEncodeBlocks(0, SUB)
        self.assertEqual(blocks.n_emb_total, 0)
        with self.assertRaises(ValueError):
            blocks.request(0, 1)


class ProbsToSegmentsTest(unittest.TestCase):
    """The whole-array reference that SegmentAccumulator must reproduce."""

    def test_threshold_is_strict(self):
        probs = np.array([[0.5], [0.5000001], [0.4999999], [0.9]])
        self.assertEqual(ds.probs_to_segments(probs, 0.5, FRAME_S),
                         [(1 * FRAME_S, 2 * FRAME_S, 0), (3 * FRAME_S, 4 * FRAME_S, 0)])
        self.assertEqual(ds.probs_to_segments(probs, 0.45, FRAME_S), [(0.0, 4 * FRAME_S, 0)])

    def test_sorted_by_start_then_slot(self):
        probs = column(20, [(1, 5)], spk=3) + column(20, [(4, 9)], spk=1) + column(20, [(4, 7)], spk=2)
        self.assertEqual(ds.probs_to_segments(probs, 0.5, FRAME_S),
                         [(1 * FRAME_S, 5 * FRAME_S, 3), (4 * FRAME_S, 9 * FRAME_S, 1), (4 * FRAME_S, 7 * FRAME_S, 2)])

    def test_default_frame_is_80_ms(self):
        self.assertEqual(ds.probs_to_segments(column(10, [(5, 10)])), [(5 * 0.08, 10 * 0.08, 0)])

    def test_default_threshold_is_the_apps(self):
        self.assertEqual(ds.DEFAULT_THRESHOLD, 0.5)                    # what finalize() passed to generate()


class SegmentAccumulatorTest(unittest.TestCase):
    def test_equals_thresholding_the_whole_recording_for_any_chunking(self):
        rng = np.random.default_rng(20261014)
        for trial in range(300):
            n = int(rng.integers(0, 700))
            probs = sticky_probs(rng, n) if trial % 2 else rng.random((n, 4))   # long runs, or flickering
            threshold = float(rng.choice([0.5, 0.3, 0.7]))
            cuts = np.sort(rng.integers(0, n + 1, size=int(rng.integers(0, 12))))
            pieces = np.split(probs, cuts)                                      # includes zero-length chunks
            acc, emitted, final = run_chunks(pieces, threshold)
            self.assertEqual(final, ds.probs_to_segments(probs, threshold, FRAME_S), (trial, n, cuts.tolist()))
            self.assertEqual(acc.frames, n)
            self.assertTrue(set(emitted) <= set(final))

    def test_chunk_length_does_not_change_the_result(self):
        rng = np.random.default_rng(7)
        probs = sticky_probs(rng, 3000)
        reference = ds.probs_to_segments(probs, 0.5, FRAME_S)
        for size in (1, 2, 7, 62, 63, 500, 2999, 3000, 5000):
            pieces = [probs[i:i + size] for i in range(0, len(probs), size)]
            self.assertEqual(run_chunks(pieces)[2], reference, size)

    def test_a_speaker_talking_across_a_chunk_join_is_one_segment(self):
        probs = column(12, [(3, 9)])
        _, emitted, final = run_chunks([probs[:6], probs[6:]])
        self.assertEqual(final, [(3 * FRAME_S, 9 * FRAME_S, 0)])
        self.assertEqual(emitted, final)

    def test_a_run_over_several_chunks_is_one_segment(self):
        probs = column(30, [(2, 28)])
        _, _, final = run_chunks([probs[:5], probs[5:15], probs[15:25], probs[25:]])
        self.assertEqual(final, [(2 * FRAME_S, 28 * FRAME_S, 0)])

    def test_a_gap_of_one_frame_at_the_join_keeps_two_segments(self):
        probs = column(12, [(3, 6), (7, 9)])
        _, _, final = run_chunks([probs[:6], probs[6:]])
        self.assertEqual(final, [(3 * FRAME_S, 6 * FRAME_S, 0), (7 * FRAME_S, 9 * FRAME_S, 0)])

    def test_a_run_ending_at_the_join_ends_there(self):
        probs = column(12, [(3, 6)])
        acc = ds.SegmentAccumulator(0.5, FRAME_S)
        self.assertEqual(acc.feed(probs[:6]), [])                       # active at the chunk's last frame: still open
        self.assertEqual(acc.feed(probs[6:]), [(3 * FRAME_S, 6 * FRAME_S, 0)])
        self.assertEqual(acc.finish(), [(3 * FRAME_S, 6 * FRAME_S, 0)])

    def test_a_run_starting_in_the_first_frame_of_a_chunk(self):
        probs = column(12, [(6, 9)])
        self.assertEqual(run_chunks([probs[:6], probs[6:]])[2], [(6 * FRAME_S, 9 * FRAME_S, 0)])

    def test_a_run_active_at_the_end_of_the_recording_is_closed_by_finish(self):
        probs = column(10, [(4, 10)])
        acc = ds.SegmentAccumulator(0.5, FRAME_S)
        self.assertEqual(acc.feed(probs), [])
        self.assertEqual(acc.finish(), [(4 * FRAME_S, 10 * FRAME_S, 0)])

    def test_a_zero_frame_chunk_does_not_close_or_split_a_run(self):
        probs = column(12, [(3, 9)])
        _, _, final = run_chunks([probs[:6], probs[6:6], probs[6:]])
        self.assertEqual(final, [(3 * FRAME_S, 9 * FRAME_S, 0)])

    def test_a_run_is_reported_when_it_ends_not_before(self):
        probs = column(30, [(2, 12)])
        acc = ds.SegmentAccumulator(0.5, FRAME_S)
        self.assertEqual(acc.feed(probs[:10]), [])
        self.assertEqual(acc.feed(probs[10:20]), [(2 * FRAME_S, 12 * FRAME_S, 0)])
        self.assertEqual(acc.feed(probs[20:]), [])
        self.assertEqual(acc.frames, 30)

    def test_different_speakers_are_never_merged_at_a_join(self):
        probs = column(12, [(3, 6)], spk=1) + column(12, [(6, 9)], spk=2)
        _, _, final = run_chunks([probs[:6], probs[6:]])
        self.assertEqual(final, [(3 * FRAME_S, 6 * FRAME_S, 1), (6 * FRAME_S, 9 * FRAME_S, 2)])

    def test_overlapping_speech_gives_one_segment_per_speaker(self):
        probs = column(12, [(2, 10)], spk=0) + column(12, [(5, 8)], spk=1)
        _, _, final = run_chunks([probs[:6], probs[6:]])
        self.assertEqual(final, [(2 * FRAME_S, 10 * FRAME_S, 0), (5 * FRAME_S, 8 * FRAME_S, 1)])

    def test_segments_closed_in_a_chunk_come_back_sorted_by_start_then_slot(self):
        probs = column(20, [(1, 5)], spk=3) + column(20, [(4, 9)], spk=1) + column(20, [(4, 7)], spk=2)
        closed = ds.SegmentAccumulator(0.5, FRAME_S).feed(probs)
        self.assertEqual(closed, [(1 * FRAME_S, 5 * FRAME_S, 3), (4 * FRAME_S, 9 * FRAME_S, 1), (4 * FRAME_S, 7 * FRAME_S, 2)])

    def test_threshold_is_strict(self):
        probs = np.array([[0.5], [0.5000001], [0.4999999], [0.9]])
        self.assertEqual(run_chunks([probs])[2], [(1 * FRAME_S, 2 * FRAME_S, 0), (3 * FRAME_S, 4 * FRAME_S, 0)])
        self.assertEqual(run_chunks([probs], threshold=0.45)[2], [(0.0, 4 * FRAME_S, 0)])

    def test_nan_is_silence(self):
        probs = np.array([[0.9], [np.nan], [0.9]])
        self.assertEqual(run_chunks([probs])[2], [(0.0, FRAME_S, 0), (2 * FRAME_S, 3 * FRAME_S, 0)])

    def test_float32_and_float64_agree(self):
        rng = np.random.default_rng(3)
        probs = rng.random((400, 4))
        self.assertEqual(run_chunks(np.split(probs, [100, 250]))[2],
                         run_chunks(np.split(probs.astype(np.float32), [100, 250]))[2])

    def test_wrong_shapes_are_rejected(self):
        acc = ds.SegmentAccumulator()
        with self.assertRaises(ValueError):
            acc.feed(np.zeros(5))
        acc.feed(np.zeros((3, 4)))
        with self.assertRaises(ValueError):
            acc.feed(np.zeros((3, 2)))

    def test_feed_after_finish_is_an_error_and_finish_is_repeatable(self):
        acc = ds.SegmentAccumulator()
        acc.feed(column(8, [(2, 8)]))
        first = acc.finish()
        self.assertEqual(acc.finish(), first)
        with self.assertRaises(RuntimeError):
            acc.feed(np.zeros((1, 4)))


class SpeakerIdTest(unittest.TestCase):
    def test_ids_are_the_model_slots_whatever_the_chunking(self):
        rng = np.random.default_rng(11)
        probs = sticky_probs(rng, 2000)
        probs[:, 0] = 0.0                                               # slot 0 never speaks: slots must not shift
        reference = ds.probs_to_segments(probs, 0.5, FRAME_S)
        slots = {spk for *_, spk in reference}
        self.assertEqual(slots, {1, 2, 3})
        for size in (1, 31, 62, 497, 2000):
            pieces = [probs[i:i + size] for i in range(0, len(probs), size)]
            final = run_chunks(pieces)[2]
            self.assertEqual(final, reference)
            self.assertEqual({spk for *_, spk in final}, slots)

    def test_a_speaker_who_first_appears_late_keeps_their_slot(self):
        probs = column(40, [(30, 38)], spk=3)
        self.assertEqual(run_chunks([probs[:10], probs[10:25], probs[25:]])[2], [(30 * FRAME_S, 38 * FRAME_S, 3)])

    def test_ids_are_plain_ints_and_segments_serialise(self):
        probs = column(10, [(1, 4)], spk=2).astype(np.float32)
        final = run_chunks([probs[:5], probs[5:]])[2]
        for start, end, spk in final:
            self.assertIs(type(spk), int)
            self.assertIs(type(start), float)
            self.assertIs(type(end), float)
        self.assertEqual(json.loads(json.dumps(final)), [list(s) for s in final])

    def test_simultaneous_starts_are_ordered_by_slot(self):
        probs = column(10, [(2, 6)], spk=3) + column(10, [(2, 5)], spk=1)
        final = run_chunks([probs[:3], probs[3:]])[2]
        self.assertEqual([spk for *_, spk in final], [1, 3])

    def test_labels_match_what_the_app_shows(self):
        probs = column(10, [(1, 4)], spk=2)
        (start, end, spk), = run_chunks([probs])[2]
        self.assertEqual(ds.speaker_label(spk), f"Speaker {spk}")


class EmptyAndShortAudioTest(unittest.TestCase):
    def test_no_chunks_no_segments(self):
        acc = ds.SegmentAccumulator()
        self.assertEqual(acc.finish(), [])
        self.assertEqual(acc.frames, 0)

    def test_only_empty_chunks(self):
        self.assertEqual(run_chunks([np.zeros((0, 4)), np.zeros((0, 4))])[2], [])

    def test_silence(self):
        self.assertEqual(run_chunks([np.zeros((62, 4)), np.zeros((13, 4))])[2], [])

    def test_a_single_frame(self):
        self.assertEqual(run_chunks([np.array([[0.0, 0.9, 0.0, 0.0]])])[2], [(0.0, FRAME_S, 1)])

    def test_audio_shorter_than_one_chunk(self):
        total, chunks = plan_for(1.0)
        self.assertEqual(len(chunks), 1)
        probs = column(chunks[0].emb_len, [(2, 9)])
        self.assertEqual(run_chunks([probs])[2], [(2 * FRAME_S, 9 * FRAME_S, 0)])

    def test_empty_probability_array(self):
        self.assertEqual(ds.probs_to_segments(np.zeros((0, 4)), 0.5, FRAME_S), [])


class NoModelDependencyTest(unittest.TestCase):
    def test_module_has_no_mlx_or_torch_import(self):
        tree = ast.parse((PYTHON_DIR / "diar_stream.py").read_text())
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(a.name.split(".")[0] for a in node.names)
            elif isinstance(node, ast.ImportFrom):
                imported.add((node.module or "").split(".")[0])
        self.assertEqual(imported, {"__future__", "typing", "numpy"})

    def test_importing_it_loads_no_model_library(self):
        code = ("import sys; sys.path.insert(0, sys.argv[1]); import diar_stream; "
                "bad = [m for m in ('mlx', 'mlx_audio', 'torch') if m in sys.modules]; "
                "sys.exit(','.join(bad) if bad else 0)")
        done = subprocess.run([sys.executable, "-c", code, str(PYTHON_DIR)], capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr)


if __name__ == "__main__":
    unittest.main()
