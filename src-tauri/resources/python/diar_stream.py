"""Model-free logic of the post-recording diarization (numpy only: no mlx import, no model).

transcribe_v3.diarize() is the thin wrapper that drives the Sortformer model. Everything that can
be decided without the model lives here, so tests/python/test_diar_stream.py covers it without one:

    choose_mode          library one-shot call for short audio, streaming procedure otherwise
    plan_chunks          chunk boundaries and right-context ranges of the streaming procedure
    PreEncodeBlocks      index bookkeeping of the block-wise right-context pre-encode
    SegmentAccumulator   thresholds per-chunk probabilities into segments; runs continue over chunk joins
    speaker_label        "Speaker N" for speaker slot N of the model

Why streaming: Sortformer.generate() pushes the whole recording through the transformer in one
pass. Its memory grows with the square of the length (about 2.7 GB for 5 min, extrapolated to
about 26 GB for a 17 min meeting) and the transformer has 1500 learned positions (120 s at 80 ms
per frame), so beyond ~2 min the speaker assignment degrades. The streaming procedure replays
Sortformer.generate_stream() (file mode of the v2.1 model: 5 s chunks, speaker cache of 188 frames,
FIFO of 188 frames, one frame of right context): every step sees a bounded context, and the right
context is pre-encoded block by block instead of for the whole recording. It was validated on AMI
meetings in engine/scripts/asr_der_eval.py.
"""

from __future__ import annotations

from typing import Dict, List, NamedTuple, Optional, Tuple

import numpy as np

STREAM_MIN_SECONDS = 120.0       # recordings of at least this length use the streaming procedure
DEFAULT_THRESHOLD = 0.5          # speaker activity threshold (strict ">", like the library)
STREAM_CHUNK_SECONDS = 5.0       # library default of generate_stream()
FIFO_FALLBACK_FRAMES = 188       # the library's FIFO size when the model config says fifo_len == 0
PREENCODE_BLOCK_FRAMES = 750     # diarization frames per right-context pre-encode block (60 s)
PREENCODE_MARGIN_FRAMES = 2      # frames of convolution context in front of a block
MODES = ("auto", "oneshot", "stream")

Segment = Tuple[float, float, int]       # (start s, end s, speaker slot of the model)


def choose_mode(duration_s: float, mode: str = "auto",
                stream_min_s: float = STREAM_MIN_SECONDS) -> str:
    """'oneshot' or 'stream' for a recording of duration_s seconds; mode forces one of them.

    The one-shot call needs the whole recording within the transformer's 1500 positions, which
    ends at exactly 120 s (a 120.0 s recording already needs 1502 frames), so recordings of
    120 s or longer stream.
    """
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}, got {mode!r}")
    if mode != "auto":
        return mode
    return "stream" if duration_s >= stream_min_s else "oneshot"


def frame_seconds(hop_length: int, subsampling: int, sample_rate: int) -> float:
    """Duration of one diarization frame (0.08 s for hop 160, subsampling 8, 16 kHz)."""
    return hop_length * subsampling / sample_rate


def expected_mel_frames(n_samples: int, hop_length: int) -> int:
    """Frames of the centred STFT of n_samples samples (the model's features.shape[2])."""
    return n_samples // hop_length + 1 if n_samples > 0 else 0


def chunk_mel_frames(chunk_s: float, sample_rate: int, hop_length: int, subsampling: int) -> int:
    """Chunk length in mel frames, exactly the library's rounding: 5 s becomes 496 frames = 4.96 s."""
    return max(round(chunk_s * sample_rate / hop_length / subsampling) * subsampling, subsampling)


def cache_sizes(spkcache_len: int, fifo_len: int) -> Tuple[int, int]:
    """(speaker cache, FIFO) frames of the streaming state: the model config's, FIFO as the library
    falls back to 188 when the config says 0."""
    return int(spkcache_len), int(fifo_len) if fifo_len > 0 else FIFO_FALLBACK_FRAMES


def _ceil_div(a: int, b: int) -> int:
    return -(-a // b)


class Chunk(NamedTuple):
    mel_start: int       # mel frames [mel_start, mel_end) are this chunk's features
    mel_end: int
    emb_start: int       # first diarization frame of the chunk in the whole recording
    emb_len: int         # diarization frames the chunk yields
    rc_start: int        # right context: pre-encoded frames [rc_start, rc_end); empty for the last chunk
    rc_end: int

    @property
    def mel_len(self) -> int:
        return self.mel_end - self.mel_start

    @property
    def has_right_context(self) -> bool:
        return self.rc_end > self.rc_start


def plan_chunks(total_mel: int, chunk_mel: int, subsampling: int, right_context: int) -> List[Chunk]:
    """Chunks of generate_stream()'s file mode over total_mel mel frames.

    All chunks but the last are chunk_mel frames; chunk_mel is a multiple of the subsampling
    factor, so every chunk starts on a diarization frame boundary and the chunks tile the
    recording without gap or overlap. The last chunk is whatever remains (never empty).
    """
    if total_mel < 0 or right_context < 0:
        raise ValueError("total_mel and right_context must not be negative")
    if chunk_mel <= 0 or chunk_mel % subsampling:
        raise ValueError(f"chunk_mel must be a positive multiple of {subsampling}, got {chunk_mel}")
    n_emb_total = _ceil_div(total_mel, subsampling)
    chunks, mel_start, emb_start = [], 0, 0
    while mel_start < total_mel:
        mel_end = min(mel_start + chunk_mel, total_mel)
        emb_len = _ceil_div(mel_end - mel_start, subsampling)
        rc_start = emb_start + emb_len
        rc_end = min(rc_start + right_context, n_emb_total) if right_context > 0 else rc_start
        chunks.append(Chunk(mel_start, mel_end, emb_start, emb_len, rc_start, rc_end))
        mel_start, emb_start = mel_end, emb_start + emb_len
    return chunks


class Block(NamedTuple):
    emb_start: int       # the block holds pre-encoded frames [emb_start, emb_end)
    emb_end: int
    mel_start: int       # computed from mel frames [mel_start, mel_end)
    mel_end: int


class PreEncodeBlocks:
    """Which pre-encode block serves the right context of a chunk (indices only, no arrays).

    The model's convolutional pre-encoder is run on blocks of PREENCODE_BLOCK_FRAMES frames
    instead of the whole recording; a new block starts PREENCODE_MARGIN_FRAMES before the first
    frame asked for, and the first frame of a block (its convolution edge) is never served.
    """

    def __init__(self, total_mel: int, subsampling: int,
                 block_frames: int = PREENCODE_BLOCK_FRAMES, margin: int = PREENCODE_MARGIN_FRAMES):
        self.total_mel = total_mel
        self.subsampling = subsampling
        self.block_frames = block_frames
        self.margin = margin
        self.n_emb_total = _ceil_div(total_mel, subsampling)
        self.blocks_started = 0
        self._block: Optional[Block] = None
        self._lo = self._hi = 0

    def request(self, a: int, b: int) -> Tuple[Optional[Block], int, int]:
        """Frames [a, b) of the whole recording (b is clipped to its end).

        Returns (new_block, lo, hi): new_block is the block to pre-encode now, or None when the
        block already held covers the request; [lo, hi) is the slice of the current block.
        """
        b = min(b, self.n_emb_total)
        if not 0 <= a < b:
            raise ValueError(f"empty or negative request [{a}, {b})")
        new = None
        if self._block is None or a < self._lo or b > self._hi:
            start = max(0, a - self.margin)
            end = min(self.n_emb_total, a + self.block_frames + self.margin)
            new = self._block = Block(start, end, start * self.subsampling,
                                      min(self.total_mel, end * self.subsampling))
            self._lo = 0 if start == 0 else start + 1
            self._hi = end
            self.blocks_started += 1
        return new, a - self._block.emb_start, b - self._block.emb_start


def probs_to_segments(probs, threshold: float = DEFAULT_THRESHOLD, frame_s: float = 0.08) -> List[Segment]:
    """Segments of a whole (frames, speakers) probability array: runs above the threshold (strict),
    sorted by (start, speaker). SegmentAccumulator returns exactly this, chunk by chunk."""
    probs = np.asarray(probs)
    segs = []
    for spk in range(probs.shape[1]):
        active = (probs[:, spk] > threshold).astype(np.int8)
        edges = np.diff(np.concatenate([[0], active, [0]]))
        for s, e in zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)):
            segs.append((float(s * frame_s), float(e * frame_s), int(spk)))
    segs.sort(key=lambda seg: (seg[0], seg[2]))
    return segs


class SegmentAccumulator:
    """Turns per-chunk probabilities into segments as chunks arrive.

    A run of frames above the threshold that reaches the end of a chunk stays open and continues
    in the next one, so a speaker talking across a chunk join is one segment, and a gap of even
    one frame at the join keeps two. Times are computed from global frame numbers, hence
    finish() equals probs_to_segments() over the concatenated chunks exactly. Speaker ids are the
    model's slot numbers (columns), never renumbered.
    """

    def __init__(self, threshold: float = DEFAULT_THRESHOLD, frame_s: float = 0.08):
        self.threshold = threshold
        self.frame_s = frame_s
        self.frames = 0                      # diarization frames consumed so far
        self._open: Dict[int, int] = {}      # speaker -> first frame of the run still open
        self._done: List[Segment] = []
        self._n_speakers: Optional[int] = None
        self._finished = False

    def _time(self, frame: int) -> float:
        return float(frame * self.frame_s)

    def feed(self, probs) -> List[Segment]:
        """Consume the (frames, speakers) probabilities of the next chunk; return the segments
        that ended inside it (sorted by start, speaker)."""
        if self._finished:
            raise RuntimeError("feed() after finish()")
        probs = np.asarray(probs)
        if probs.ndim != 2:
            raise ValueError("probs must have shape (frames, speakers)")
        n, k = probs.shape
        if self._n_speakers is None:
            self._n_speakers = k
        elif k != self._n_speakers:
            raise ValueError(f"expected {self._n_speakers} speaker columns, got {k}")
        if n == 0:
            return []
        base = self.frames
        closed: List[Segment] = []
        for spk in range(k):
            carried = self._open.pop(spk, None)
            active = probs[:, spk] > self.threshold
            edges = np.diff(np.concatenate(([carried is not None], active, [False])).astype(np.int8))
            starts = [base + int(i) for i in np.flatnonzero(edges == 1)]
            ends = [base + int(i) for i in np.flatnonzero(edges == -1)]
            if carried is not None:
                starts.insert(0, carried)
            if ends and ends[-1] == base + n:        # still active at the chunk's last frame
                self._open[spk] = starts.pop()
                ends.pop()
            closed.extend((self._time(s), self._time(e), spk) for s, e in zip(starts, ends))
        self.frames += n
        closed.sort(key=lambda seg: (seg[0], seg[2]))
        self._done.extend(closed)
        return closed

    def finish(self) -> List[Segment]:
        """Close the runs still open at the end of the recording; return all segments sorted by
        (start, speaker)."""
        if not self._finished:
            for spk, start in self._open.items():
                self._done.append((self._time(start), self._time(self.frames), spk))
            self._open.clear()
            self._done.sort(key=lambda seg: (seg[0], seg[2]))
            self._finished = True
        return list(self._done)


def speaker_label(slot: int) -> str:
    """Label of speaker slot `slot`, as the app shows it ("Speaker 0", ...)."""
    return f"Speaker {int(slot)}"
