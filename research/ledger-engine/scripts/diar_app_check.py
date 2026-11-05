#!/usr/bin/env python3
"""Check of the app's REAL post-recording path: transcribe_server.finalize() with the streaming diarization of
transcribe_v3.diarize() / diar_stream.py, on the three demo meetings and one AMI meeting.

Not the replica of asr_der_eval.py: the app's own scripts are imported from app/src-tauri/resources/python and
finalize() is called on the recording cut into 100 ms capture blocks, as the app does. Only transcribe_server.emit is
redirected and timing wrappers sit around the STT call, transcribe_v3.diarize_with_info and
transcribe_v3.stream_probabilities (they forward every call unchanged and only record).

Interpreters
    /opt/homebrew/bin/python3.11 (the app's)   model workers: import the app scripts, load Parakeet + Sortformer, run
                                               finalize(). Nothing beyond what the app needs (+ numpy, scipy, soundfile).
    engine/.venv-asr/bin/python                driver and evaluation: jiwer and pyannote.metrics are installed only
                                               there (the system python lacks jiwer). It starts the workers with the
                                               app's python (--app-python).

Usage (models run on the GPU: only after the go-ahead)
    engine/.venv-asr/bin/python engine/scripts/diar_app_check.py all
        run [--force] [--only demo_1,ami_IS1009a] [--skip-limited] [--skip-compare] [--ami-meeting ID]
                                       model passes, strictly one worker process at a time, resumable per run
        evaluate                       WER / DER / tables from the saved raw outputs (no model)
        selftest                       CPU only: fake models from the app's unit tests, checks the plumbing and the
                                       metric code end to end (no mlx import, no GPU, writes to a scratch folder)
        worker ITEM                    (internal) one model process

Runs, in this order (engine/results/asr/app_path_raw/<run>.json, .segments.json, .stt.json, .probs.npz, .worker.log, .hyp.txt)
    demo_1 demo_2 demo_3        finalize() on engine/data/demo/audio/meeting_N.wav; reference meeting_N.ref.txt / .rttm
    ami_<ID>_cache0.5           finalize() on the shortest complete AMI meeting (audio in engine/data/ami/audio if that
                                folder exists, else data/ami/audio) with MLX's allocator cache limited to 0.5 GB, as in
                                the replica runs
    compare                     forced one-shot and forced streaming diarization on the same audio (demos in full,
                                clips of 10-120 s of five AMI meetings): evidence for the one-shot / streaming threshold
    ami_<ID>                    the same AMI meeting with the app's default MLX settings; last, because it may use the
                                most memory (a 7-9 GB footprint was seen with the replica)

Outputs: engine/results/asr/app_path_check.md and app_path_check.json
"""

import sys

sys.dont_write_bytecode = True   # importing the app's scripts must not leave __pycache__ folders in the app tree

import argparse
import contextlib
import datetime
import hashlib
import io
import json
import os
import re
import resource
import shutil
import subprocess
import time
from collections import defaultdict
from pathlib import Path
from types import SimpleNamespace

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import asr_der_eval as ev  # noqa: E402  (text normalisation, metrics, replica pipeline; imports no mlx)

ROOT = ev.ROOT
APP_DIR = ROOT / "app"
APP_PY_DIR = APP_DIR / "src-tauri/resources/python"
APP_TESTS = APP_DIR / "tests/python"
APP_FILES = ("diar_stream.py", "transcribe_v3.py", "transcribe_server.py")
DEMO_DIR = ROOT / "engine/data/demo/audio"
AMI_AUDIO_DIRS = (ROOT / "engine/data/ami/audio", ROOT / "data/ami/audio")   # first one that exists
OUT_DIR = ROOT / "engine/results/asr"
RAW_DIR = OUT_DIR / "app_path_raw"
SCRIPT = Path(__file__).resolve()
APP_PYTHON = "/opt/homebrew/bin/python3.11"

DEMOS = (1, 2, 3)
BLOCK_SAMPLES = 1600             # the app captures 100 ms blocks (transcribe_server.BLOCK_SIZE)
WARMUP_S = 20                    # excerpt used to compile kernels before the timed runs
MEM_LIMIT_GB = 8.0               # a worker aborts when MLX active memory exceeds this (exit code 86)
LIMITED_CACHE_GB = 0.5           # allocator cache limit of the replica runs
COLLAR = 0.25
CLIP_LENGTHS = (10, 20, 30, 60, 90, 120)                          # seconds
CLIP_STARTS = {"IS1009a": (60, 330, 600), "ES2004a": (100, 450, 800), "ES2014a": (100, 450, 800),
               "TS3003a": (100, 600, 1100), "TS3007a": (100, 600, 1100)}   # seconds into the meeting
STREAM_MAX_RTF = 0.05             # cost bound of the threshold rule: streaming may take at most 6 s per 2 min of audio
BOOTSTRAP_RESAMPLES, BOOTSTRAP_SEED = 2000, 0
TASK = ("Real finalize() path of the app (streaming diarization for recordings of 2 min or more) versus the "
        "validated replica of asr_der_eval.py")


# --------------------------------------------------------------------------------------------------
# Items, files, provenance
# --------------------------------------------------------------------------------------------------
def ami_audio_dir():
    """The first candidate folder that holds at least one complete AMI meeting (also set as ev.AUDIO_DIR)."""
    for d in AMI_AUDIO_DIRS:
        if d.is_dir():
            ev.AUDIO_DIR = d
            if ev.complete_meetings():
                return d
    raise SystemExit(f"no complete AMI meeting in {', '.join(str(d) for d in AMI_AUDIO_DIRS)}")


def pick_ami(preferred=None):
    """(meeting, seconds) of the shortest complete AMI meeting, or of `preferred`."""
    ev.AUDIO_DIR = ami_audio_dir()
    avail = ev.complete_meetings()
    if preferred:
        if preferred not in avail:
            raise SystemExit(f"AMI meeting {preferred} is not complete in {ev.AUDIO_DIR} ({sorted(avail)})")
        return preferred, avail[preferred]
    if not avail:
        raise SystemExit(f"no complete AMI meeting in {ev.AUDIO_DIR}")
    meeting = min(avail, key=avail.get)
    return meeting, avail[meeting]


def run_name(item, cache_limit_gb=None):
    return item if cache_limit_gb is None else f"{item}_cache{cache_limit_gb:g}"


def source_of(item):
    """(kind, id, wav) of a recording item: 'demo_2' or 'ami_IS1009a'."""
    kind, _, ident = item.partition("_")
    if kind == "demo":
        return "demo", f"meeting_{ident}", DEMO_DIR / f"meeting_{ident}.wav"
    if kind == "ami":
        return "ami", ident, ami_audio_dir() / f"{ident}.wav"
    raise ValueError(f"unknown item {item!r}")


def plan_runs(ami_meeting, skip_limited=False, skip_compare=False):
    """(item, MLX cache limit in GB or None) in the order they run. The AMI run with the app's default MLX cache, the one
    that may use the most memory (7-9 GB footprint seen with the replica), goes last."""
    plan = [(f"demo_{n}", None) for n in DEMOS]
    if not skip_limited:
        plan.append((f"ami_{ami_meeting}", LIMITED_CACHE_GB))
    if not skip_compare:
        plan.append(("compare", None))
    plan.append((f"ami_{ami_meeting}", None))
    return plan


def app_provenance():
    def git(*args):
        try:
            return subprocess.run(["git", "-C", str(APP_DIR), *args], capture_output=True, text=True,
                                  timeout=30).stdout.strip()
        except Exception:
            return None
    lines = lambda text: None if text is None else text.splitlines()     # [] = clean, None = git failed
    return {"git_head": git("rev-parse", "HEAD"), "git_status_short": lines(git("status", "--short")),
            "python_status_short": lines(git("status", "--short", "--", "src-tauri/resources/python", "tests/python")),
            "sha256": {n: hashlib.sha256((APP_PY_DIR / n).read_bytes()).hexdigest() for n in APP_FILES}}


def now_iso():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def wav_frames(path):
    import soundfile as sf
    return sf.info(str(path)).frames


def load_audio(path):
    """The app's own reader (asr_der_eval.load_wav), with the sample count checked against soundfile; AMI files end
    with non-audio chunks that scipy only warns about."""
    import warnings
    from scipy.io import wavfile
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", wavfile.WavFileWarning)
        audio = ev.load_wav(path)
    if len(audio) != wav_frames(path):
        raise RuntimeError(f"{path}: read {len(audio)} samples, the file has {wav_frames(path)}")
    return audio


# --------------------------------------------------------------------------------------------------
# Model worker: the app's finalize() on one recording (imports mlx; only runs inside a worker process)
# --------------------------------------------------------------------------------------------------
def load_real_env():
    """The app's own scripts and models, as transcribe_server.run_live() loads them."""
    sys.path.insert(0, str(APP_PY_DIR))
    import mlx.core as mx
    import transcribe_server as ts
    import transcribe_v3 as tv
    from mlx_audio.stt.utils import load as load_stt
    from mlx_audio.vad.utils import load_model as load_vad
    return SimpleNamespace(mx=mx, tv=tv, ts=ts, load_stt=lambda: load_stt(ts.STT), load_diar=lambda: load_vad(ts.DIAR),
                           start_guard=lambda limit_gb: ev.start_memory_guard(mx, limit_gb))


class SttProxy:
    """The STT model with a stopwatch on generate(); finalize() calls it once, on the whole recording."""

    def __init__(self, stt, mx, record):
        self._stt, self._mx, self._record = stt, mx, record

    def generate(self, *args, **kwargs):
        t = time.perf_counter()
        out = self._stt.generate(*args, **kwargs)
        self._record["stt"] = {"seconds": time.perf_counter() - t, "mlx_peak_bytes": self._mx.get_peak_memory(),
                               "chunk_duration": kwargs.get("chunk_duration"),
                               "result": {"text": getattr(out, "text", None),
                                          "sentences": [[[tok.text, float(tok.start), float(tok.end)] for tok in s.tokens]
                                                        for s in out.sentences]}}
        return out


@contextlib.contextmanager
def instrumented(env, record):
    """Record what finalize() emits and what its diarization step does, without changing either:
    the emitted events, the diarization call (seconds, MLX peak, mode, segments) and the speaker probabilities of every
    streamed chunk. transcribe_v3.diarize() looks both functions up in its module globals at call time."""
    mx, tv, ts = env.mx, env.tv, env.ts
    record.update(events=[], prob_chunks=[], diarize=None)
    original_emit, original_dwi, original_sp = ts.emit, tv.diarize_with_info, tv.stream_probabilities

    def diarize_with_info(diar, audio, *args, **kwargs):
        mx.reset_peak_memory()
        t = time.perf_counter()
        segments, info = original_dwi(diar, audio, *args, **kwargs)
        record["diarize"] = {"seconds": time.perf_counter() - t, "mlx_peak_bytes": mx.get_peak_memory(),
                             "info": info, "segments": [list(s) for s in segments]}
        return segments, info

    def stream_probabilities(diar, audio, *args, **kwargs):
        for chunk in original_sp(diar, audio, *args, **kwargs):
            record["prob_chunks"].append(np.array(chunk))
            yield chunk

    ts.emit, tv.diarize_with_info, tv.stream_probabilities = record["events"].append, diarize_with_info, stream_probabilities
    try:
        yield
    finally:
        ts.emit, tv.diarize_with_info, tv.stream_probabilities = original_emit, original_dwi, original_sp


def warm_up(env, diar, audio, stt=None):
    """Cold-start cost (kernel compilation), paid outside the timed runs: first call of the STT and of each
    diarization path on an excerpt. In the app the first diarization call happens at finalize() and is cold."""
    mx, tv = env.mx, env.tv
    clip = audio[: WARMUP_S * ev.SAMPLE_RATE]
    out = {}
    if stt is not None:
        t = time.perf_counter()
        stt.generate(mx.array(clip), chunk_duration=ev.STT_CHUNK_S)
        out["stt_s"] = time.perf_counter() - t
    for mode in ("stream", "oneshot"):
        t = time.perf_counter()
        tv.diarize_with_info(diar, clip, mode=mode)
        out[f"diarize_{mode}_s"] = time.perf_counter() - t
    return out


def app_parameters(env):
    ds = env.tv.diar_stream
    return {"STREAM_MIN_SECONDS": ds.STREAM_MIN_SECONDS, "STREAM_CHUNK_SECONDS": ds.STREAM_CHUNK_SECONDS,
            "DIAR_THRESHOLD": env.tv.DIAR_THRESHOLD, "capture_block_samples": BLOCK_SAMPLES, **app_provenance()}


def run_worker(env, item, raw_dir, cache_limit_gb=None, mem_limit_gb=MEM_LIMIT_GB):
    """finalize() of the app on one recording, in a fresh process with freshly loaded models."""
    kind, ident, wav = source_of(item)
    name = run_name(item, cache_limit_gb)
    raw_dir.mkdir(parents=True, exist_ok=True)
    mx, ts = env.mx, env.ts
    env.start_guard(mem_limit_gb)
    if cache_limit_gb is not None:
        mx.set_cache_limit(int(cache_limit_gb * 1e9))
    audio = load_audio(wav)
    audio_s = len(audio) / ev.SAMPLE_RATE

    t = time.perf_counter()
    stt, diar = env.load_stt(), env.load_diar()
    t_load = time.perf_counter() - t
    warm = warm_up(env, diar, audio, stt)

    captured = [audio[i:i + BLOCK_SAMPLES] for i in range(0, len(audio), BLOCK_SAMPLES)]
    record = {}
    mx.reset_peak_memory()
    with instrumented(env, record):
        t = time.perf_counter()
        ts.finalize(SttProxy(stt, mx, record), diar, captured)
        finalize_s = time.perf_counter() - t
    finalize_peak = mx.get_peak_memory()

    finals = [e for e in record["events"] if e.get("type") == "final"]
    if len(finals) != 1 or record["diarize"] is None or "stt" not in record:
        raise RuntimeError(f"finalize() did not run as expected: events={record['events']}")
    final = finals[0]
    json.dumps(final)                                            # the event protocol is JSON lines
    stt_rec, dia_rec = record["stt"], record["diarize"]

    probs = np.concatenate(record["prob_chunks"], axis=0) if record["prob_chunks"] else None
    sub = diar.config.fc_encoder_config.subsampling_factor
    expected_frames = -(-env.tv.diar_stream.expected_mel_frames(len(audio), diar._processor_config.hop_length) // sub)
    timing = {"load_models_s": t_load, "cold_first_calls_s": warm, "finalize_s": finalize_s,
              "stt_s": stt_rec["seconds"], "diarize_s": dia_rec["seconds"],
              "other_s": finalize_s - stt_rec["seconds"] - dia_rec["seconds"]}
    meta = {
        "run": name, "item": item, "kind": kind, "meeting": ident, "source": str(wav), "audio_s": audio_s,
        "models": {"stt": ts.STT, "diarization": ts.DIAR},
        "app": {**app_parameters(env), "stt_chunk_duration": stt_rec["chunk_duration"]},
        "diarize_info": dia_rec["info"],
        "diar_frames": {"streamed": None if probs is None else int(probs.shape[0]), "expected": int(expected_frames)},
        "timing_s": timing,
        "rtf": {k: timing[f"{k}_s"] / audio_s for k in ("finalize", "stt", "diarize")},
        "mlx_peak_gb": {"stt": stt_rec["mlx_peak_bytes"] / 1e9, "diarize": dia_rec["mlx_peak_bytes"] / 1e9,
                        "finalize": finalize_peak / 1e9},
        "mlx_cache_limit_gb": cache_limit_gb, "mem_guard_gb": mem_limit_gb,
        "ru_maxrss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        "final_event": final, "other_events": [e for e in record["events"] if e is not final],
        "interpreter": sys.executable, "versions": ev.lib_versions(), "machine": ev.machine_info(),
        "finished": now_iso(), "complete": False,     # set by the driver once /usr/bin/time's numbers are attached
    }
    (raw_dir / f"{name}.segments.json").write_text(json.dumps(dia_rec["segments"]))
    (raw_dir / f"{name}.stt.json").write_text(json.dumps(stt_rec["result"]))
    if probs is not None:
        np.savez_compressed(raw_dir / f"{name}.probs.npz", probs=probs,
                            frame_duration=env.tv.diar_stream.frame_seconds(
                                diar._processor_config.hop_length, sub, diar._processor_config.sampling_rate))
    (raw_dir / f"{name}.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps({"run": name, "audio_s": audio_s, "mode": dia_rec["info"]["mode"], "timing_s": timing,
                      "rtf": meta["rtf"], "mlx_peak_gb": meta["mlx_peak_gb"]}), flush=True)


def run_compare(env, raw_dir, mem_limit_gb=MEM_LIMIT_GB):
    """Forced one-shot and forced streaming diarization on the same audio: the demo recordings in full and clips of
    AMI meetings (each clip as a recording of its own). Diarization model only; no STT is loaded."""
    mx, tv = env.mx, env.tv
    raw_dir.mkdir(parents=True, exist_ok=True)
    env.start_guard(mem_limit_gb)
    sources = [("demo", f"meeting_{n}", load_audio(DEMO_DIR / f"meeting_{n}.wav"), {}) for n in DEMOS]
    ev.AUDIO_DIR = ami_audio_dir()
    avail = ev.complete_meetings()
    for meeting, starts in CLIP_STARTS.items():
        if meeting not in avail:
            continue
        audio = load_audio(ev.AUDIO_DIR / f"{meeting}.wav")
        for start in starts:
            for length in CLIP_LENGTHS:
                lo, hi = int(start * ev.SAMPLE_RATE), int((start + length) * ev.SAMPLE_RATE)
                if hi <= len(audio):
                    sources.append(("clip", f"{meeting}@{start}+{length}", audio[lo:hi].copy(),
                                    {"meeting": meeting, "start": start, "length": length}))
        del audio

    t = time.perf_counter()
    diar = env.load_diar()
    t_load = time.perf_counter() - t
    warm = warm_up(env, diar, sources[0][2])
    runs = []
    for kind, label, audio, extra in sources:
        for mode in ("stream", "oneshot"):
            mx.clear_cache()
            mx.reset_peak_memory()
            t = time.perf_counter()
            segments, info = tv.diarize_with_info(diar, audio, mode=mode)
            seconds = time.perf_counter() - t
            assert info["mode"] == mode, info
            runs.append({"kind": kind, "label": label, "mode": mode, "audio_s": len(audio) / ev.SAMPLE_RATE,
                         "seconds": seconds, "mlx_peak_gb": mx.get_peak_memory() / 1e9, "info": info,
                         "segments": [list(s) for s in segments], **extra})
            print(f"{label:>22s} {mode:>7s} {len(audio) / ev.SAMPLE_RATE:6.1f} s -> {seconds:6.2f} s, "
                  f"{len(segments)} segments", flush=True)
    meta = {"run": "compare", "kind": "compare", "models": {"diarization": env.ts.DIAR},
            "app": app_parameters(env), "timing_s": {"load_diar_s": t_load, "cold_first_calls_s": warm},
            "mlx_cache_limit_gb": None, "runs": runs, "interpreter": sys.executable, "versions": ev.lib_versions(),
            "machine": ev.machine_info(), "finished": now_iso(), "complete": False}
    (raw_dir / "compare.json").write_text(json.dumps(meta, indent=2))


# --------------------------------------------------------------------------------------------------
# Driver
# --------------------------------------------------------------------------------------------------
def mark_complete(path, process):
    meta = json.loads(path.read_text())
    meta["process"] = process
    meta["complete"] = True
    path.write_text(json.dumps(meta, indent=2))


def ensure_metrics():
    try:
        import jiwer  # noqa: F401
        import pyannote.metrics  # noqa: F401
    except ImportError as e:
        raise SystemExit(f"{e}: jiwer and pyannote.metrics are installed only in engine/.venv-asr; "
                         "run this command with engine/.venv-asr/bin/python")


def cmd_run(args):
    app_python = args.app_python
    if not Path(app_python).exists():
        raise SystemExit(f"app python not found: {app_python}")
    meeting, seconds = pick_ami(args.ami_meeting)
    print(f"AMI meeting: {meeting} ({seconds / 60:.1f} min)", flush=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    plan = plan_runs(meeting, args.skip_limited, args.skip_compare)
    only = {x for x in args.only.split(",") if x}
    names = [run_name(i, c) for i, c in plan]
    if only - set(names):
        raise SystemExit(f"--only: unknown run(s) {sorted(only - set(names))}; valid: {names}")
    failures = []
    for (item, limit), name in zip(plan, names):
        if only and name not in only:
            continue
        path = RAW_DIR / f"{name}.json"
        if not args.force and path.exists() and json.loads(path.read_text()).get("complete"):
            print(f"[skip] {name} already complete", flush=True)
            continue
        path.unlink(missing_ok=True)                  # never keep a stale result when a re-run fails
        cmd = ["/usr/bin/time", "-l", app_python, str(SCRIPT), "worker", item]
        if limit is not None:
            cmd += ["--cache-limit-gb", str(limit)]
        print(f"[run ] {name} ...", flush=True)
        t = time.time()
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
        (RAW_DIR / f"{name}.worker.log").write_text(proc.stdout + "\n--- stderr ---\n" + proc.stderr)
        if proc.returncode != 0 or not path.exists():
            print(f"[FAIL] {name}: exit code {proc.returncode} (see app_path_raw/{name}.worker.log)", flush=True)
            failures.append(name)
            continue
        mark_complete(path, ev.parse_time_l(proc.stderr))
        print(f"[done] {name}: {time.time() - t:.0f} s wall", flush=True)
    return failures


# --------------------------------------------------------------------------------------------------
# References and metrics (same normalisation and metrics as asr_der_eval.py)
# --------------------------------------------------------------------------------------------------
def read_rttm(path):
    rows = []
    for line in Path(path).read_text().splitlines():
        f = line.split()
        if len(f) >= 8 and f[0] == "SPEAKER":
            rows.append((float(f[3]), float(f[4]), f[7]))
    return rows


def strip_speaker(line, names):
    """'Wei Ling: Two weeks.' -> 'Two weeks.' for a known speaker name (RTTM labels use '_' for spaces)."""
    m = re.match(r"^([^:]{1,40}):\s*(.*)$", line)
    if m and m.group(1).strip().replace(" ", "_") in names:
        return m.group(2)
    return line


def demo_reference(label):
    """Tokens of ref.txt (speaker names removed) and the RTTM annotation of a demo meeting."""
    from pyannote.core import Annotation, Segment
    rows = read_rttm(DEMO_DIR / f"{label}.rttm")
    ann = Annotation(uri=label)
    for start, dur, name in rows:
        ann[Segment(start, start + dur), name] = name
    names = {name for _, _, name in rows}
    lines = [ln for ln in (DEMO_DIR / f"{label}.ref.txt").read_text().splitlines() if ln.strip()]
    tokens = [t for ln in lines for t in ev.norm_tokens(strip_speaker(ln, names))]
    return {"name": "demo_rttm", "tokens": tokens, "ann": ann, "n_turns": len(rows), "n_lines": len(lines)}


def ami_reference(meeting):
    """The replica's primary AMI reference: manual words in time order; segments with a lexical word, same-speaker
    gaps of at most 0.3 s merged."""
    ref = ev.load_reference(meeting)
    words, _ = ev.ref_word_stream(ref, "time")
    tokens = [t for w in words for t in ev.norm_tokens(w["text"])]
    return {"name": "seg_lex_gap0.3", "tokens": tokens, "ann": ev.ref_annotation(ref, meeting, "seg_lex", 0.3)}


def reference_for(meta, cache):
    key = (meta["kind"], meta["meeting"])
    if key not in cache:
        cache[key] = demo_reference(meta["meeting"]) if meta["kind"] == "demo" else ami_reference(meta["meeting"])
    return cache[key]


def crop_shift(ann, start, length):
    """The part of an annotation inside [start, start + length], shifted to begin at 0."""
    from pyannote.core import Annotation, Segment
    out = Annotation(uri=ann.uri)
    for seg, track, label in ann.crop(Segment(start, start + length), mode="intersection").itertracks(yield_label=True):
        out[Segment(seg.start - start, seg.end - start), track] = label
    return out


def stt_namespace(d):
    """A saved STT result (text + [[token text, start, end], ...] per sentence) as the objects aligned_words() reads."""
    return SimpleNamespace(text=d.get("text"), sentences=[
        SimpleNamespace(tokens=[SimpleNamespace(text=t, start=a, end=b) for t, a, b in sent]) for sent in d["sentences"]])


def words_annotation(words, labels, uri, gap=0.3):
    """The speaker of every transcribed word, runs of one speaker closer than `gap` s joined (the replica's
    'app_words' hypothesis: what the transcript attributes to each speaker)."""
    from pyannote.core import Annotation, Segment
    by_label = defaultdict(list)
    for (start, end, _), label in zip(words, labels):
        by_label[label].append((start, end))
    ann = Annotation(uri=uri)
    for label, intervals in by_label.items():
        for a, b in ev.merge_intervals(intervals, gap):
            ann[Segment(a, b), f"S{label}"] = f"S{label}"
    return ann


def wer_of(ref_tokens, hyp_tokens):
    if not hyp_tokens:
        n = len(ref_tokens)
        return {"n_ref": n, "n_hyp": 0, "S": 0, "D": n, "I": 0, "H": 0, "wer": 1.0 if n else 0.0}
    return ev.wer_stats(ref_tokens, hyp_tokens)[1]


def der_both(ref_ann, hyp_ann, dur):
    """DER components and rates, collar 0.25 s, with and without the overlapped-speech regions."""
    out = {}
    for skip in (False, True):
        c = ev.der_components(ref_ann, hyp_ann, dur, COLLAR, skip)
        out[f"skip_overlap={skip}"] = {**c, **ev.der_rates(c)}
    return out


def score(run, audio_s, final, segments, stt, ref):
    """WER of the final transcript; DER of the diarization segments and of the speaker given to every word.
    The word labels and the turns are rebuilt from the segments and the STT tokens with the evaluation's copy of
    aligned_words() / build_turns(); `turns_rebuilt_equal` says that this reproduces what finalize() emitted."""
    hyp_tokens = [t for turn in final["turns"] for t in ev.norm_tokens(turn["text"])]
    words, labels = ev.aligned_words(stt_namespace(stt), segments)
    rebuilt = [{"t0": round(a, 1), "t1": round(b, 1), "speaker": f"Speaker {k}", "text": txt}
               for a, b, k, txt in ev.build_turns(words, labels)]
    return {"wer": wer_of(ref["tokens"], hyp_tokens),
            "der": {"segments": der_both(ref["ann"], ev.hyp_annotation(segments, run), audio_s),
                    "words": der_both(ref["ann"], words_annotation(words, labels, run), audio_s)},
            "turns_rebuilt_equal": rebuilt == final["turns"],
            "n_hyp_speakers": len({s[2] for s in segments}), "n_ref_speakers": len(ref["ann"].labels()),
            "n_turns": len(final["turns"]), "hyp_tokens": hyp_tokens}


# --------------------------------------------------------------------------------------------------
# Evaluation
# --------------------------------------------------------------------------------------------------
def load_runs(raw_dir):
    runs = {}
    for path in sorted(raw_dir.glob("*.json")):
        if path.stem == "compare" or path.name.endswith((".segments.json", ".stt.json")):
            continue
        meta = json.loads(path.read_text())
        if not meta.get("complete"):
            continue
        name = meta["run"]
        meta["segments"] = [tuple(s) for s in json.loads((raw_dir / f"{name}.segments.json").read_text())]
        meta["stt"] = json.loads((raw_dir / f"{name}.stt.json").read_text())
        npz = raw_dir / f"{name}.probs.npz"
        meta["probs"] = np.load(npz)["probs"] if npz.exists() else None
        runs[name] = meta
    return runs


def stored_replica(results_path, meeting):
    try:
        rows = {m["meeting"]: m for m in json.loads(Path(results_path).read_text())["meetings"]}
        m = rows[meeting]
        c = m["der"][ev.PRIMARY_DER_KEY]
        w = m["der"].get(ev.der_key("seg_lex_gap0.3", ev.DIAR_THRESHOLD, COLLAR, False, hyp="app_words"))
        return {"wer": m["wer"]["primary"], "der": {**c, **ev.der_rates(c)},
                "words_der": None if w is None else {**w, **ev.der_rates(w)}}
    except Exception:
        return None


def replica_outputs(meeting):
    """The replica's final turns and segments for a meeting, from its stored raw model outputs (no model)."""
    rmeta, rresult, rprobs, fd = ev.load_raw(meeting)
    rstt = json.loads((ev.RAW_DIR / f"{meeting}.stt.json").read_text())
    segments = ev.probs_to_segments(rprobs, ev.DIAR_THRESHOLD, fd)
    words, labels = ev.aligned_words(rresult, segments)
    turns = [{"t0": round(s, 1), "t1": round(e, 1), "speaker": f"Speaker {spk}", "text": txt}
             for s, e, spk, txt in ev.build_turns(words, labels)]
    return rmeta, rstt, rprobs, segments, turns


def compare_with_replica(meta, ref, scored, stored):
    meeting = meta["meeting"]
    if not (ev.RAW_DIR / f"{meeting}.json").exists():
        return {"meeting": meeting, "note": "no replica raw outputs for this meeting"}
    rmeta, rstt, rprobs, rsegs, rturns = replica_outputs(meeting)
    rscored = score(f"replica_{meeting}", rmeta["audio_s"], {"turns": rturns}, rsegs, rstt, ref)
    probs = meta["probs"]
    same_shape = probs is not None and probs.shape == rprobs.shape
    out = {
        "meeting": meeting, "replica_recomputed": {k: rscored[k] for k in ("wer", "der")},
        "replica_stored": stored, "app_probs_shape": None if probs is None else list(probs.shape),
        "replica_probs_shape": list(rprobs.shape),
        "probs_identical": bool(same_shape and np.array_equal(probs, rprobs)),
        "probs_max_abs_diff": float(np.abs(probs - rprobs).max()) if same_shape else None,
        "frames_with_different_activity": int(((probs > ev.DIAR_THRESHOLD) != (rprobs > ev.DIAR_THRESHOLD))
                                              .any(axis=1).sum()) if same_shape else None,
        "segments_identical": sorted(meta["segments"]) == sorted(rsegs),
        "stt_tokens_identical": meta["stt"]["sentences"] == rstt["sentences"],
        "transcript_words_identical": scored["hyp_tokens"] == rscored["hyp_tokens"],
        "turns_identical": rturns == meta["final_event"]["turns"],
        "replica_speed": {"timing_s": rmeta["timing_s"], "rtf": rmeta["rtf"], "mlx_peak_gb": rmeta["mlx_peak_gb"],
                          "mlx_cache_limit_gb": rmeta.get("mlx_cache_limit_gb"), "process": rmeta.get("process")},
    }
    if stored:
        out["recomputed_equals_stored"] = {
            "wer": abs(rscored["wer"]["wer"] - stored["wer"]["wer"]) < 1e-9,
            "der": abs(rscored["der"]["segments"]["skip_overlap=False"]["der"] - stored["der"]["der"]) < 1e-9,
            "words_der": stored["words_der"] is not None and abs(
                rscored["der"]["words"]["skip_overlap=False"]["der"] - stored["words_der"]["der"]) < 1e-9}
    return out


def evaluate_compare(raw_dir, cache):
    path = raw_dir / "compare.json"
    if not path.exists() or not json.loads(path.read_text()).get("complete"):
        return None
    meta = json.loads(path.read_text())
    rows = []
    for r in meta["runs"]:
        if r["kind"] == "demo":
            ref_ann = demo_reference(r["label"])["ann"]
        else:
            ref_ann = crop_shift(reference_for({"kind": "ami", "meeting": r["meeting"]}, cache)["ann"],
                                 r["start"], r["audio_s"])
        c = ev.der_components(ref_ann, ev.hyp_annotation(r["segments"], r["label"]), r["audio_s"], COLLAR, False)
        rows.append({k: v for k, v in r.items() if k != "segments"} | {"der": {**c, **ev.der_rates(c)},
                     "n_segments": len(r["segments"]), "n_hyp_speakers": len({s[2] for s in r["segments"]})})
    clips = pool_clips(rows)
    return {"timing_s": meta["timing_s"], "app": meta["app"], "runs": rows,
            "demos": [r for r in rows if r["kind"] == "demo"], "clips_by_length": clips,
            "threshold_rule": THRESHOLD_RULE, "threshold_suggestion_s": threshold_suggestion(clips)}


THRESHOLD_RULE = ("STREAM_MIN_SECONDS = the smallest tested clip length L such that, for L and for every longer tested "
                  "length, the pooled DER of streaming is at most that of the one-shot call and streaming's real-time "
                  f"factor is at most {STREAM_MAX_RTF}; none if the longest tested length already fails")


def delta_der_ci(clips):
    """Pooled DER of one-shot minus DER of streaming over `clips` (positive: streaming better) and a 95 % percentile
    bootstrap interval that resamples whole clips (fixed seed). clips: [(ref speech s, one-shot error s, stream error s)]."""
    ref, one, st = (np.array(col, float) for col in zip(*clips))
    point = (one.sum() - st.sum()) / ref.sum()
    idx = np.random.RandomState(BOOTSTRAP_SEED).randint(0, len(clips), size=(BOOTSTRAP_RESAMPLES, len(clips)))
    t, o, k = ref[idx].sum(1), one[idx].sum(1), st[idx].sum(1)
    d = (o - k)[t > 0] / t[t > 0]
    lo, hi = np.percentile(d, [2.5, 97.5])
    return {"point": float(point), "ci95": [float(lo), float(hi)], "resamples": BOOTSTRAP_RESAMPLES,
            "seed": BOOTSTRAP_SEED}


def threshold_suggestion(entries, max_rtf=STREAM_MAX_RTF):
    """The value of STREAM_MIN_SECONDS the rule above gives for the pooled clip results (None if none qualifies)."""
    suggestion = None
    for e in sorted(entries, key=lambda e: -e["length_s"]):
        o, t = e["modes"]["oneshot"], e["modes"]["stream"]
        if t["der"] is None or o["der"] is None or t["der"] > o["der"] or t["rtf"] > max_rtf:
            break
        suggestion = e["length_s"]
    return suggestion


def pool_clips(rows):
    """Per clip length: pooled DER, time and memory of forced one-shot and forced streaming, and per-clip wins."""
    out = []
    lengths = sorted({r["length"] for r in rows if r["kind"] == "clip"})
    for length in lengths:
        entry = {"length_s": length, "modes": {}}
        by_label = defaultdict(dict)
        for r in rows:
            if r["kind"] == "clip" and r["length"] == length:
                by_label[r["label"]][r["mode"]] = r
        for mode in ("oneshot", "stream"):
            rs = [d[mode] for d in by_label.values() if mode in d]
            tot = sum(r["der"]["total_s"] for r in rs)
            comp = {k: sum(r["der"][k] for r in rs) for k in ("miss_s", "fa_s", "conf_s")}
            entry["modes"][mode] = {
                "n_clips": len(rs), "total_ref_speech_s": tot, **comp,
                "der": sum(comp.values()) / tot if tot else None,
                "miss": comp["miss_s"] / tot if tot else None, "fa": comp["fa_s"] / tot if tot else None,
                "conf": comp["conf_s"] / tot if tot else None,
                "mean_seconds": float(np.mean([r["seconds"] for r in rs])) if rs else None,
                "rtf": sum(r["seconds"] for r in rs) / sum(r["audio_s"] for r in rs) if rs else None,
                "max_mlx_peak_gb": max((r["mlx_peak_gb"] for r in rs), default=None)}
        wins = {"stream_better": 0, "oneshot_better": 0, "equal": 0}
        pairs = []
        for d in by_label.values():
            if len(d) == 2 and d["stream"]["der"]["total_s"] > 0:
                a, b = d["stream"]["der"]["der"], d["oneshot"]["der"]["der"]
                wins["stream_better" if a < b - 1e-9 else "oneshot_better" if b < a - 1e-9 else "equal"] += 1
                err = lambda r: r["der"]["miss_s"] + r["der"]["fa_s"] + r["der"]["conf_s"]
                pairs.append((d["stream"]["der"]["total_s"], err(d["oneshot"]), err(d["stream"])))
        entry["clips_where"] = wins
        entry["delta_der"] = delta_der_ci(pairs) if pairs else None
        out.append(entry)
    return out


def pool_demos(runs):
    """Demo recordings pooled: WER over all reference words, DER over all reference speech."""
    demos = [r for r in runs.values() if r["kind"] == "demo"]
    if len(demos) < 2:
        return None
    tot = {k: sum(r["der"]["segments"]["skip_overlap=False"][k] for r in demos) for k in ("total_s", "miss_s", "fa_s", "conf_s")}
    sdih = {k: sum(r["wer"][k] for r in demos) for k in ("S", "D", "I", "H")}
    n = sdih["S"] + sdih["D"] + sdih["H"]
    return {"runs": sorted(r["meeting"] for r in demos), "n_ref_words": n, **sdih, "wer": (sdih["S"] + sdih["D"] + sdih["I"]) / n,
            **tot, "der": (tot["miss_s"] + tot["fa_s"] + tot["conf_s"]) / tot["total_s"],
            "miss": tot["miss_s"] / tot["total_s"], "fa": tot["fa_s"] / tot["total_s"], "conf": tot["conf_s"] / tot["total_s"]}


def hyp_text(final):
    return "\n".join(f"[{t['t0']:.1f}s - {t['t1']:.1f}s] {t['speaker']}: {t['text']}" for t in final["turns"]) + "\n"


def evaluate(raw_dir=RAW_DIR, out_dir=OUT_DIR, results_path=OUT_DIR / "results.json"):
    ensure_metrics()
    runs = load_runs(raw_dir)
    if not runs:
        raise SystemExit(f"no complete run in {raw_dir}: run the model passes first")
    cache, summary_runs, ami = {}, {}, {}
    for name, meta in runs.items():
        ref = reference_for(meta, cache)
        scored = score(name, meta["audio_s"], meta["final_event"], meta["segments"], meta["stt"], ref)
        (raw_dir / f"{name}.hyp.txt").write_text(hyp_text(meta["final_event"]))
        summary_runs[name] = {
            "kind": meta["kind"], "meeting": meta["meeting"], "audio_s": meta["audio_s"],
            "diarize_info": meta["diarize_info"], "mlx_cache_limit_gb": meta["mlx_cache_limit_gb"],
            "reference": ref["name"], "n_ref_tokens": len(ref["tokens"]),
            **{k: scored[k] for k in ("wer", "der", "turns_rebuilt_equal", "n_hyp_speakers", "n_ref_speakers", "n_turns")},
            "frames": meta["diar_frames"], "timing_s": meta["timing_s"], "rtf": meta["rtf"],
            "mlx_peak_gb": meta["mlx_peak_gb"], "process": meta.get("process"), "ru_maxrss_bytes": meta["ru_maxrss_bytes"],
            "stt_chunk_duration": meta["app"]["stt_chunk_duration"], "diarize_threshold": meta["app"]["DIAR_THRESHOLD"]}
        if meta["kind"] == "ami":
            ami[name] = compare_with_replica(meta, ref, scored, stored_replica(results_path, meta["meeting"]))
    compare = evaluate_compare(raw_dir, cache)
    first = next(iter(runs.values()))
    code = code_check({n: m["app"] for n, m in runs.items()} | ({"compare": compare["app"]} if compare else {}))
    ami_runs = [m for m in runs.values() if m["kind"] == "ami"]
    ami_selection = None
    if ami_runs:
        ev.AUDIO_DIR = Path(ami_runs[0]["source"]).parent
        shortest = sorted(ev.complete_meetings().items(), key=lambda kv: kv[1])[:5]
        ami_selection = {"audio_dir": str(ev.AUDIO_DIR), "rule": "shortest complete meeting (or --ami-meeting)",
                         "shortest_complete_min": {m: round(sec / 60, 2) for m, sec in shortest}}
    summary = {
        "generated": now_iso(), "script": str(SCRIPT.relative_to(ROOT)), "task": TASK,
        "interpreters": {"evaluation": sys.executable,
                         "model_workers": sorted({m["interpreter"] for m in runs.values()}),
                         "app_python": APP_PYTHON},
        "app": first["app"], "models": first["models"],
        "parameters": {"collar_s": COLLAR, "uem": "[0, audio duration]", "wer_normalisation": "asr_der_eval.norm_tokens",
                       "ami_reference": "seg_lex_gap0.3 (as the replica)", "demo_reference": "meeting_N.rttm / meeting_N.ref.txt",
                       "capture_block_samples": BLOCK_SAMPLES, "warmup_s": WARMUP_S, "mem_guard_gb": MEM_LIMIT_GB,
                       "clip_lengths_s": list(CLIP_LENGTHS), "clip_starts_s": CLIP_STARTS},
        "code_check": code, "ami_selection": ami_selection, "runs": summary_runs, "demo_pooled": pool_demos(summary_runs),
        "ami_vs_replica": ami or None, "mode_comparison": compare,
        "level_probe": probe_summary(out_dir / "app_path_level_probe.json"),
        "versions": {"workers": first["versions"], "evaluation": ev.lib_versions()}, "machine": first["machine"],
        "missing": [n for n in expected_runs(runs) if n not in runs] + ([] if compare else ["compare"])}
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "app_path_check.json").write_text(json.dumps(summary, indent=2))
    (out_dir / "app_path_check.md").write_text(render_markdown(summary))
    return summary


def probe_summary(path):
    """Headline numbers of the supplementary input-level probe (diar_level_probe.py), None if it was not run."""
    try:
        p = json.loads(Path(path).read_text())
        pair = next(c for c in p["paired_over_starts"] if (c["a"], c["b"]) == ("oneshot", "peaknorm"))
        return {"file": Path(path).with_suffix(".md").name, "clips": p["clips"], "lengths_s": p["lengths_s"],
                "der": {v: p["overall"][v]["der"] for v in ("oneshot", "original", "peaknorm", "minus20db")},
                "oneshot_minus_peaknorm": {"delta_der": pair["delta_der"], "ci95": pair["ci95"]}}
    except (OSError, ValueError, KeyError, StopIteration):
        return None


def code_check(app_by_run):
    """Did every model run use the same app scripts, and are they the files on disk now? (sha256 of the three scripts)"""
    now = {n: hashlib.sha256((APP_PY_DIR / n).read_bytes()).hexdigest() for n in APP_FILES}
    groups = defaultdict(list)
    for name, app in sorted(app_by_run.items()):
        groups[json.dumps(app["sha256"], sort_keys=True)].append(name)
    return {"n_runs": len(app_by_run), "same_code_in_all_runs": len(groups) == 1,
            "runs_not_matching_files_now": sorted(n for n, app in app_by_run.items() if app["sha256"] != now),
            "stream_min_seconds_in_runs": sorted({app["STREAM_MIN_SECONDS"] for app in app_by_run.values()})}


def expected_runs(runs):
    amis = sorted({m["meeting"] for m in runs.values() if m["kind"] == "ami"})
    return [f"demo_{n}" for n in DEMOS] + [f"ami_{amis[0] if amis else '<meeting>'}"]


# --------------------------------------------------------------------------------------------------
# Report
# --------------------------------------------------------------------------------------------------
def pct(x, nd=1):
    return "n/a" if x is None else f"{100 * x:.{nd}f}"


def num(x, nd=2):
    return "n/a" if x is None else f"{x:.{nd}f}"


def md_table(header, rows):
    lines = ["| " + " | ".join(header) + " |", "|" + "|".join("---" for _ in header) + "|"]
    return "\n".join(lines + ["| " + " | ".join(str(c) for c in r) + " |" for r in rows])


def summary_bullets(s):
    runs = s["runs"]
    by_mode = defaultdict(list)
    for name, r in runs.items():
        by_mode[r["diarize_info"]["mode"]].append(name)
    out = ["finalize() of the app ran on {} recordings; diarization mode: {}.".format(
        len(runs), "; ".join(f"{m}: {', '.join(v)}" for m, v in sorted(by_mode.items())))]
    short = [n for n, r in runs.items() if r["diarize_info"]["mode"] == "stream"
             and r["frames"]["streamed"] != r["frames"]["expected"]]
    if short:
        out.append(f"WARNING: {', '.join(short)}: the streaming pass produced a different number of diarization frames "
                   "than the length of the recording implies.")
    if not all(r["turns_rebuilt_equal"] for r in runs.values()):
        out.append("WARNING: for " + ", ".join(n for n, r in runs.items() if not r["turns_rebuilt_equal"]) +
                   " the evaluation's copy of aligned_words()/build_turns() does not reproduce the turns finalize() emitted.")
    pooled = s["demo_pooled"]
    if pooled:
        out.append(f"Demo meetings (script reference): WER {pct(pooled['wer'])} %, DER {pct(pooled['der'])} % "
                   f"(miss {pct(pooled['miss'])}, FA {pct(pooled['fa'])}, conf {pct(pooled['conf'])}).")
    for name, c in (s["ami_vs_replica"] or {}).items():
        if "note" in c:
            continue
        a, rep = runs[name], c["replica_recomputed"]
        same = c["probs_identical"] and c["segments_identical"] and c["stt_tokens_identical"] and c["turns_identical"]
        out.append(f"{name}: DER {pct(a['der']['segments']['skip_overlap=False']['der'])} % (replica "
                   f"{pct(rep['der']['segments']['skip_overlap=False']['der'])} %), WER {pct(a['wer']['wer'])} % (replica "
                   f"{pct(rep['wer']['wer'])} %); probabilities, segments, STT tokens and turns "
                   f"{'identical to the replica' if same else 'NOT all identical to the replica (see section 2)'}.")
    cmp_ = s["mode_comparison"]
    if cmp_ and cmp_["clips_by_length"]:
        parts = []
        for e in cmp_["clips_by_length"]:
            o, t, dd = e["modes"]["oneshot"], e["modes"]["stream"], e["delta_der"]
            parts.append(f"{e['length_s']} s: {pct(o['der'])} -> {pct(t['der'])} (stream better in "
                         f"{e['clips_where']['stream_better']} of {t['n_clips']} clips)")
        sug = cmp_["threshold_suggestion_s"]
        out.append("Pooled DER %, one-shot -> streaming, AMI clips: " + "; ".join(parts) + ". Threshold rule gives "
                   + (f"STREAM_MIN_SECONDS = {sug:g} s" if sug is not None else "no value")
                   + f"; the app uses {s['app']['STREAM_MIN_SECONDS']:g} s.")
    lp = s.get("level_probe")
    if lp:
        d, g = lp["der"], lp["oneshot_minus_peaknorm"]
        out.append(f"Input level (supplementary probe `{lp['file']}`; {lp['clips']} AMI clips of "
                   f"{'/'.join(str(x) for x in lp['lengths_s'])} s, streaming path): DER {pct(d['original'])} % at the original "
                   f"level, {pct(d['peaknorm'])} % peak-normalised, {pct(d['minus20db'])} % at -20 dB; one-shot minus "
                   f"peak-normalised streaming {100 * g['delta_der']:+.1f} points [{100 * g['ci95'][0]:+.1f}, "
                   f"{100 * g['ci95'][1]:+.1f}].")
    ami = [(n, r) for n, r in runs.items() if r["kind"] == "ami"]
    if ami:
        n, r = ami[0]
        p = r["process"] or {}
        out.append(f"{n}: finalize() {num(r['timing_s']['finalize_s'], 1)} s for {num(r['audio_s'], 1)} s of audio "
                   f"(RTF {num(r['rtf']['finalize'], 3)}); process peak footprint "
                   f"{num(p['peak_footprint_bytes'] / 1e9) if p.get('peak_footprint_bytes') else 'n/a'} GB.")
    return out


def code_line(s):
    app, chk = s["app"], s["code_check"]
    py = app.get("python_status_short")
    state = ("state of the app's Python scripts against HEAD unknown" if py is None
             else "the app's Python scripts and tests are identical to HEAD" if not py
             else "the app's Python scripts or tests have uncommitted changes (" + "; ".join(py) + ")")
    other = len(app["git_status_short"] or []) - len(py or [])        # paths outside the Python folders
    line = (f"{state}" + (f" ({other} other uncommitted path(s) elsewhere in the app repo are not part of this check)"
                          if other > 0 else "") + "; sha256 (first 12): "
            + ", ".join(f"{k} `{v[:12]}`" for k, v in app["sha256"].items()) + ". ")
    if chk["same_code_in_all_runs"] and not chk["runs_not_matching_files_now"]:
        line += f"All {chk['n_runs']} model runs used exactly these files."
    else:
        line += ("**WARNING: the model runs did not all use the app scripts that are on disk now"
                 + (f" (differing: {', '.join(chk['runs_not_matching_files_now'])})" if chk["runs_not_matching_files_now"] else "")
                 + "; re-run them with --force before relying on this report.**")
    return line


def render_markdown(s):
    runs = s["runs"]
    ordered = sorted(runs.items(), key=lambda kv: (kv[1]["kind"] != "demo", kv[0]))
    L = ["# App path check: finalize() with streaming diarization", "",
         f"Generated {s['generated']} by `{s['script']}`. {s['task']}.", "",
         f"- App code: git HEAD `{(s['app']['git_head'] or '?')[:10]}`; " + code_line(s),
         f"- Method: the real `transcribe_server.finalize()` on the recording cut into {s['parameters']['capture_block_samples']}-sample "
         "(100 ms) capture blocks, models loaded as in the app; `emit` is captured and the timing wrappers only record "
         "(they forward every call unchanged).",
         f"- Models: STT `{s['models']['stt']}`, diarization `{s['models']['diarization']}`",
         *([f"- AMI meeting: {s['ami_selection']['rule']} in `{s['ami_selection']['audio_dir']}`; shortest complete "
            f"meetings (minutes): {', '.join(f'{m} {v}' for m, v in s['ami_selection']['shortest_complete_min'].items())}"]
           if s["ami_selection"] else []),
         f"- Model workers ran with `{', '.join(s['interpreters']['model_workers'])}` (the app's python is "
         f"`{s['interpreters']['app_python']}`); metrics ran with `{s['interpreters']['evaluation']}` "
         "(jiwer and pyannote.metrics are only in that venv).",
         f"- Threshold of the app: recordings of at least {s['app']['STREAM_MIN_SECONDS']:g} s stream "
         f"({s['app']['STREAM_CHUNK_SECONDS']:g} s chunks), shorter ones use the library's one-shot call; "
         f"speaker threshold {s['app']['DIAR_THRESHOLD']}."]
    if s["missing"]:
        L += ["", f"**Missing / failed runs: {', '.join(s['missing'])}**"]
    L += ["", "## Summary", ""] + [f"- {b}" for b in summary_bullets(s)]

    L += ["", "## 1. Accuracy of the app's final output", "",
          "WER: final transcript against the reference, `asr_der_eval.norm_tokens` on both sides. DER: pyannote.metrics, "
          f"collar {COLLAR} s, optimal speaker mapping, UEM = whole recording; DER = the diarization segments the app "
          "works on, 'DER % of words' = the speaker the transcript gives to every word (runs closer than 0.3 s joined; "
          "the replica's 'app_words').", ""]
    rows = []
    for name, r in ordered:
        d, dw, w = r["der"]["segments"], r["der"]["words"], r["wer"]
        rows.append([name, num(r["audio_s"], 1), r["diarize_info"]["mode"],
                     f"{r['n_hyp_speakers']}/{r['n_ref_speakers']}", pct(w["wer"]), f"{w['S']}/{w['D']}/{w['I']}",
                     w["n_ref"], pct(d["skip_overlap=False"]["der"]), pct(d["skip_overlap=False"]["miss"]),
                     pct(d["skip_overlap=False"]["fa"]), pct(d["skip_overlap=False"]["conf"]),
                     pct(d["skip_overlap=True"]["der"]), pct(dw["skip_overlap=False"]["der"])])
    L.append(md_table(["run", "audio s", "diarization", "speakers hyp/ref", "WER %", "S/D/I", "ref words", "DER %", "miss %",
                       "FA %", "conf %", "DER % skip overlap", "DER % of words"], rows))
    pooled = s["demo_pooled"]
    if pooled:
        L += ["", f"Demo meetings pooled: WER {pct(pooled['wer'])} % (S/D/I {pooled['S']}/{pooled['D']}/{pooled['I']}, "
                  f"{pooled['n_ref_words']} ref words), DER {pct(pooled['der'])} % (miss {pct(pooled['miss'])}, "
                  f"FA {pct(pooled['fa'])}, conf {pct(pooled['conf'])})."]

    if s["ami_vs_replica"]:
        L += ["", "## 2. AMI meeting: app path versus the replica of asr_der_eval.py", "",
              "The replica ran the same models with the same procedure outside the app (Parakeet with 120 s chunks, "
              "bounded streaming Sortformer). Probabilities, segments and turns of the replica are rebuilt from its stored "
              "raw outputs and compared with what the app's finalize() produced.", ""]
        rows = []
        for name, c in s["ami_vs_replica"].items():
            if "note" in c:
                rows.append([name, c["note"]] + [""] * 11)
                continue
            a, rep = runs[name], c["replica_recomputed"]
            yes = lambda flag: "yes" if flag else "no"
            rows.append([name, c["meeting"],
                         pct(a["der"]["segments"]["skip_overlap=False"]["der"]),
                         pct(rep["der"]["segments"]["skip_overlap=False"]["der"]),
                         pct(a["der"]["words"]["skip_overlap=False"]["der"]),
                         pct(rep["der"]["words"]["skip_overlap=False"]["der"]),
                         pct(a["wer"]["wer"]), pct(rep["wer"]["wer"]),
                         yes(c["probs_identical"]) if c["probs_identical"] else f"no (max |diff| {c['probs_max_abs_diff']})",
                         c["frames_with_different_activity"], yes(c["segments_identical"]),
                         yes(c["stt_tokens_identical"]), yes(c["turns_identical"])])
        L.append(md_table(["app run", "meeting", "app DER %", "replica DER %", "app DER % of words",
                           "replica DER % of words", "app WER %", "replica WER %", "probabilities identical",
                           "frames differing", "segments identical", "STT tokens identical", "turns identical"], rows))
        first = next((c for c in s["ami_vs_replica"].values() if "note" not in c), None)
        if first and first["replica_stored"]:
            st = first["replica_stored"]
            L += ["", f"Replica numbers stored in results.json for {first['meeting']}: DER {pct(st['der']['der'])} % "
                      f"(miss {pct(st['der']['miss'])}, FA {pct(st['der']['fa'])}, conf {pct(st['der']['conf'])}), "
                      f"WER {pct(st['wer']['wer'])} % (S/D/I {st['wer']['S']}/{st['wer']['D']}/{st['wer']['I']}); "
                      f"recomputed here from the raw outputs: "
                      f"{'identical' if all(first['recomputed_equals_stored'].values()) else 'DIFFERENT'}."]

    cmp_ = s["mode_comparison"]
    if cmp_:
        n_clips = max(e["modes"]["stream"]["n_clips"] for e in cmp_["clips_by_length"]) if cmp_["clips_by_length"] else 0
        L += ["", "## 3. One-shot versus streaming diarization on the same audio", "",
              "Forced modes (`diarize_with_info(mode=...)` of the app) on identical audio, warm, diarization model only. "
              f"Clips are cut from AMI meetings ({', '.join(f'{m} at {list(v)} s' for m, v in CLIP_STARTS.items())}), up to "
              f"{n_clips} per length; each clip is a recording of its own, scored against the cropped AMI reference "
              "(DER, collar 0.25 s, overlap scored). The clips of one start are nested (the 30 s clip is the beginning of "
              "the 60 s one), so the lengths are not independent samples. The one-shot call cannot take 120 s or more "
              "(it needs 1502 positions and has 1500 at 120 s): for the demos of 120 s and more its numbers show the old "
              "behaviour. Evidence for the one-shot / streaming threshold `STREAM_MIN_SECONDS`.", ""]
        rows = []
        for d in cmp_["demos"]:
            rows.append([d["label"], num(d["audio_s"], 1), d["mode"], pct(d["der"]["der"]), pct(d["der"]["miss"]),
                         pct(d["der"]["fa"]), pct(d["der"]["conf"]), num(d["seconds"]), num(d["mlx_peak_gb"])])
        L.append(md_table(["demo", "audio s", "mode", "DER %", "miss %", "FA %", "conf %", "seconds", "MLX peak GB"], rows))
        rows = []
        for e in cmp_["clips_by_length"]:
            o, t = e["modes"]["oneshot"], e["modes"]["stream"]
            w = e["clips_where"]
            dd = e.get("delta_der")
            rows.append([e["length_s"], t["n_clips"], pct(o["der"]), pct(t["der"]),
                         "n/a" if not dd else f"{pct(dd['point'])} [{pct(dd['ci95'][0])}, {pct(dd['ci95'][1])}]",
                         f"{pct(o['miss'])} / {pct(t['miss'])}",
                         f"{pct(o['fa'])} / {pct(t['fa'])}", f"{pct(o['conf'])} / {pct(t['conf'])}",
                         f"{num(o['mean_seconds'])} / {num(t['mean_seconds'])}", f"{num(o['rtf'], 3)} / {num(t['rtf'], 3)}",
                         f"{num(o['max_mlx_peak_gb'])} / {num(t['max_mlx_peak_gb'])}",
                         f"{w['stream_better']} / {w['oneshot_better']} / {w['equal']}"])
        L += ["", md_table(["clip s", "clips", "DER % one-shot", "DER % stream",
                            "DER points one-shot minus stream [95 % CI]", "miss % (1s / st)", "FA % (1s / st)",
                            "conf % (1s / st)", "mean s (1s / st)", "RTF (1s / st)", "max MLX GB (1s / st)",
                            "clips: stream better / one-shot better / equal"], rows)]
        sug = cmp_["threshold_suggestion_s"]
        L += ["", f"The interval resamples whole clips ({BOOTSTRAP_RESAMPLES} resamples, seed {BOOTSTRAP_SEED}); positive "
                  "means streaming has the lower DER. Max MLX GB is the process peak of the diarization-only worker "
                  "(weights included).",
              "", f"Threshold rule: {cmp_['threshold_rule']}. Result: "
              + (f"**{sug:g} s**" if sug is not None else "no length qualifies")
              + f"; the app's constant is {s['app']['STREAM_MIN_SECONDS']:g} s."]

    L += ["", "## 4. Speed and memory", "",
          "finalize() wall clock = STT + diarization + alignment, measured after a warm-up on a 20 s excerpt; the cold "
          "first calls are listed separately (in the app the first diarization call happens at finalize() and is cold). "
          "MLX peak: `mx.get_peak_memory()`, reset before finalize() and again before the diarization call (both models' "
          "weights are resident). Process: `/usr/bin/time -l` of the whole worker (loading, warm-up, finalize).", ""]
    rows = []
    for name, r in ordered:
        t, p = r["timing_s"], r["process"] or {}
        cold = t["cold_first_calls_s"]
        rows.append([name, num(r["audio_s"], 1), num(t["finalize_s"], 1), num(t["stt_s"], 1),
                     num(t["diarize_s"], 1), num(t["other_s"], 2), num(r["rtf"]["finalize"], 3), num(r["rtf"]["stt"], 3),
                     num(r["rtf"]["diarize"], 3), num(t["load_models_s"], 1),
                     f"{num(cold.get('stt_s'), 1)} / {num(cold.get('diarize_stream_s'), 1)} / {num(cold.get('diarize_oneshot_s'), 1)}",
                     num(r["mlx_peak_gb"]["stt"]), num(r["mlx_peak_gb"]["diarize"]),
                     num((p.get("max_rss_bytes") or r["ru_maxrss_bytes"]) / 1e9),
                     num(p["peak_footprint_bytes"] / 1e9) if p.get("peak_footprint_bytes") else "n/a"])
    L.append(md_table(["run", "audio s", "finalize s", "STT s", "diarize s", "align s", "RTF finalize", "RTF STT",
                       "RTF diarize", "load s", "cold s (STT / stream / one-shot)", "MLX peak STT GB",
                       "MLX peak diar GB", "max RSS GB", "peak footprint GB"], rows))
    for name, c in (s["ami_vs_replica"] or {}).items():
        if "replica_speed" in c:
            sp = c["replica_speed"]
            L += ["", f"Replica for {c['meeting']} (cache limit {sp['mlx_cache_limit_gb']} GB, same models): STT "
                      f"{num(sp['timing_s']['stt'], 1)} s, diarization {num(sp['timing_s']['diar'], 1)} s, RTF STT+diar "
                      f"{num(sp['rtf']['stt_plus_diar'], 3)}, MLX peak STT {num(sp['mlx_peak_gb']['stt'])} / diarization "
                      f"{num(sp['mlx_peak_gb']['diar'])} GB, peak footprint "
                      f"{num((sp['process'] or {}).get('peak_footprint_bytes', 0) / 1e9)} GB."]
            break

    L += ["", "## 5. Caveats", "",
          "- The demo recordings are the three scripted demo meetings, not AMI; their reference is the script "
          "(`ref.txt`) and the RTTM next to the audio, so WER measures the transcript against the script text.",
          "- The AMI audio is the headset mix (near-field); the app records far-field microphone audio.",
          "- DER of the AMI meeting counts overlapped speech (AMI is spontaneous); the 'skip overlap' column removes it.",
          "- One run per recording: no repeats. The replica's bit-exact reproducibility was shown separately "
          "(asr/README.md).",
          "- Timing depends on whatever else uses the GPU at that moment.",
          "- Streaming still computes the log-mel features of the whole recording at once, so MLX memory grows "
          "linearly (about 0.05 GB per minute) beyond the model weights.", ""]
    return "\n".join(L)


# --------------------------------------------------------------------------------------------------
# Self-test: CPU only, fake models, scratch folder
# --------------------------------------------------------------------------------------------------
class ScriptedStt:
    def __init__(self, result):
        self.result, self.calls = result, []

    def generate(self, audio, chunk_duration=None):
        self.calls.append((len(audio), chunk_duration))
        return self.result


def selftest(keep=False):
    ensure_metrics()
    assert ev.parse_time_l("       12.34 real   1.0 user   0.5 sys\n  1675624448  maximum resident set size\n"
                           "  5559963056  peak memory footprint\n") == {
        "wall_s": 12.34, "max_rss_bytes": 1675624448.0, "peak_footprint_bytes": 5559963056.0}
    assert run_name("ami_X", None) == "ami_X" and run_name("ami_X", 0.5) == "ami_X_cache0.5"
    assert source_of("demo_2")[1:] == ("meeting_2", DEMO_DIR / "meeting_2.wav")
    assert plan_runs("M") == [("demo_1", None), ("demo_2", None), ("demo_3", None), ("ami_M", LIMITED_CACHE_GB),
                              ("compare", None), ("ami_M", None)]
    assert plan_runs("M", skip_limited=True, skip_compare=True)[-1] == ("ami_M", None) and len(plan_runs("M", True, True)) == 4
    entry = lambda n, one, st, rtf=0.02: {"length_s": n, "modes": {"oneshot": {"der": one, "rtf": 0.003},
                                                                   "stream": {"der": st, "rtf": rtf}}}
    assert threshold_suggestion([entry(30, .4, .3), entry(60, .4, .3), entry(120, .4, .3)]) == 30
    assert threshold_suggestion([entry(30, .3, .4), entry(60, .4, .3), entry(120, .4, .3)]) == 60
    assert threshold_suggestion([entry(30, .4, .3), entry(60, .3, .4), entry(120, .4, .3)]) == 120
    assert threshold_suggestion([entry(30, .4, .3), entry(120, .3, .4)]) is None
    assert threshold_suggestion([entry(30, .4, .3), entry(120, .4, .3, rtf=0.2)]) is None
    assert threshold_suggestion([entry(30, .3, .3), entry(60, .3, .3)]) == 30     # equal is not worse
    d = delta_der_ci([(10.0, 4.0, 2.0)] * 5)
    assert abs(d["point"] - 0.2) < 1e-12 and abs(d["ci95"][0] - 0.2) < 1e-12 and abs(d["ci95"][1] - 0.2) < 1e-12, d
    d = delta_der_ci([(10.0, 4.0, 2.0), (10.0, 1.0, 3.0), (20.0, 6.0, 2.0)])
    assert abs(d["point"] - (11.0 - 7.0) / 40.0) < 1e-12 and d["ci95"][0] < d["point"] < d["ci95"][1], d
    assert delta_der_ci([(10.0, 4.0, 2.0), (10.0, 1.0, 3.0), (20.0, 6.0, 2.0)]) == d      # fixed seed: reproducible
    meeting, seconds = pick_ami()
    assert seconds > 0, meeting
    for wav in (DEMO_DIR / "meeting_3.wav", ami_audio_dir() / f"{meeting}.wav"):
        audio = load_audio(wav)
        assert audio.dtype == np.float32 and len(audio) == wav_frames(wav) and np.abs(audio).max() <= 1.0001, wav      # int16 / 32767 as the app's loader does

    # references and metric plumbing: the script itself scores 0 % WER / 0 % DER, a damaged copy does not
    from pyannote.core import Annotation, Segment
    for n in DEMOS:
        ref = demo_reference(f"meeting_{n}")
        assert ref["n_turns"] == ref["n_lines"] and len(ref["tokens"]) > 50, (n, ref["n_turns"], ref["n_lines"])
        assert wer_of(ref["tokens"], list(ref["tokens"]))["wer"] == 0.0
        damaged = list(ref["tokens"])
        del damaged[5], damaged[20]
        damaged[40] = "zzz"
        w = wer_of(ref["tokens"], damaged)
        assert (w["S"], w["D"], w["I"]) == (1, 2, 0), w
        assert wer_of(ref["tokens"], [])["wer"] == 1.0
        d = der_both(ref["ann"], ref["ann"], seconds_of_demo(n))
        assert d["skip_overlap=False"]["der"] == 0.0 and d["skip_overlap=True"]["der"] == 0.0
        shifted = Annotation(uri="x")
        for seg, _, label in ref["ann"].itertracks(yield_label=True):
            shifted[Segment(seg.start + 1.0, seg.end + 1.0), label] = label
        assert der_both(ref["ann"], shifted, seconds_of_demo(n) + 1.0)["skip_overlap=False"]["der"] > 0.1
    ann = Annotation(uri="u")
    ann[Segment(10, 20), "a"] = "a"
    ann[Segment(25, 40), "b"] = "b"
    cropped = crop_shift(ann, 15, 20)
    assert [(s.start, s.end, lab) for s, _, lab in cropped.itertracks(yield_label=True)] == [(0, 5, "a"), (10, 20, "b")]

    scratch = OUT_DIR / "_diar_app_check_selftest"
    shutil.rmtree(scratch, ignore_errors=True)
    scratch.mkdir(parents=True)
    try:
        selftest_dry_run(scratch)
        selftest_driver(scratch)
    finally:
        if keep:
            print(f"scratch folder kept: {scratch}")
        else:
            shutil.rmtree(scratch, ignore_errors=True)
    print("selftest OK")


FAKE_WORKER = """#!/bin/sh
# stands in for: <app python> diar_app_check.py worker ITEM [--cache-limit-gb X]
name="$3"
[ "$4" = "--cache-limit-gb" ] && name="$3_cache$5"
echo "$name" >> "$FAKE_CALLS"
if [ "$name" = "$FAKE_FAIL" ]; then echo boom >&2; exit 3; fi
mkdir -p "$FAKE_RAW"
echo "{\\"run\\": \\"$name\\", \\"complete\\": false}" > "$FAKE_RAW/$name.json"
echo ok
"""


def selftest_driver(scratch):
    """cmd_run() with a fake worker interpreter (a shell script) under the real /usr/bin/time -l: run order, the
    time -l numbers, completion marking, resume, --force, --only and a failing worker."""
    global RAW_DIR
    fake, calls, raw = scratch / "fake_worker.sh", scratch / "calls.txt", scratch / "raw_driver"
    fake.write_text(FAKE_WORKER)
    fake.chmod(0o755)
    keys = ("FAKE_CALLS", "FAKE_RAW", "FAKE_FAIL")
    saved_env, saved_raw = {k: os.environ.get(k) for k in keys}, RAW_DIR
    RAW_DIR = raw
    os.environ.update(FAKE_CALLS=str(calls), FAKE_RAW=str(raw))
    meeting, _ = pick_ami()
    order = [run_name(i, c) for i, c in plan_runs(meeting)]

    def go(fail="", **kw):
        os.environ["FAKE_FAIL"] = fail
        calls.write_text("")
        opts = dict(app_python=str(fake), ami_meeting=None, skip_limited=False, skip_compare=False, only="", force=False)
        with contextlib.redirect_stdout(io.StringIO()):
            failures = cmd_run(SimpleNamespace(**{**opts, **kw}))
        return failures, calls.read_text().split()

    try:
        assert order == ["demo_1", "demo_2", "demo_3", f"ami_{meeting}_cache0.5", "compare", f"ami_{meeting}"], order
        failures, ran = go(fail="demo_2")
        assert failures == ["demo_2"] and ran == order, (failures, ran)
        assert "boom" in (raw / "demo_2.worker.log").read_text() and not (raw / "demo_2.json").exists()
        for name in order:
            if name != "demo_2":
                m = json.loads((raw / f"{name}.json").read_text())
                pr = m["process"]
                assert m["complete"] and pr["max_rss_bytes"] > 0 and pr["peak_footprint_bytes"] > 0 and pr["wall_s"] >= 0, m
        failures, ran = go()
        assert failures == [] and ran == ["demo_2"], (failures, ran)          # resumed: only the missing run
        failures, ran = go(force=True, only="demo_1,compare")
        assert failures == [] and ran == ["demo_1", "compare"], (failures, ran)
        failures, ran = go(fail="demo_1", force=True, only="demo_1")           # a failed re-run leaves no stale result
        assert failures == ["demo_1"] and not (raw / "demo_1.json").exists(), (failures, ran)
        failures, ran = go(skip_limited=True, skip_compare=True, force=True)
        assert failures == [] and ran == ["demo_1", "demo_2", "demo_3", f"ami_{meeting}"], (failures, ran)
        try:
            go(only="nonsense")
        except SystemExit as e:
            assert "nonsense" in str(e)
        else:
            raise AssertionError("an unknown --only name was accepted")
    finally:
        RAW_DIR = saved_raw
        for k, v in saved_env.items():
            os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)


def seconds_of_demo(n):
    return wav_frames(DEMO_DIR / f"meeting_{n}.wav") / ev.SAMPLE_RATE


def bytecode_state():
    """{path: mtime} of the .pyc files in the app's script and test folders (importing must not add or change any)."""
    return {str(p): p.stat().st_mtime_ns for d in (APP_PY_DIR, APP_TESTS) for p in d.rglob("*.pyc")}


def selftest_dry_run(scratch):
    """The whole chain with fake models: worker (real transcribe_server.finalize, fake Sortformer / STT of the app's
    unit tests), the driver's bookkeeping, the evaluation and the report."""
    sys.path.insert(0, str(APP_TESTS))
    import test_transcribe_v3_diarize as fk
    pyc_before = bytecode_state()
    fk.setUpModule()
    try:
        mx = fk.ts.mx
        mx.get_peak_memory = lambda: 2_000_000_000
        mx.get_active_memory = lambda: 1_000_000_000
        mx.reset_peak_memory = mx.clear_cache = lambda: None
        mx.set_cache_limit = lambda nbytes: None

        def env_for(diar, stt):
            return SimpleNamespace(mx=mx, tv=fk.tv, ts=fk.ts, load_stt=lambda: stt, load_diar=lambda: diar,
                                   start_guard=lambda gb: None)

        def demo_env(n):
            label = f"meeting_{n}"
            rows = read_rttm(DEMO_DIR / f"{label}.rttm")
            names = {name for _, _, name in rows}
            lines = [ln for ln in (DEMO_DIR / f"{label}.ref.txt").read_text().splitlines() if ln.strip()]
            slots = {}
            for _, _, name in rows:
                slots.setdefault(name, len(slots))
            truth = np.zeros((fk.n_emb_for(wav_frames(DEMO_DIR / f"{label}.wav")), 4), np.float32)
            sentences = []
            for (start, dur, name), line in zip(rows, lines):
                truth[int(round(start / fk.FRAME_S)): int(round((start + dur) / fk.FRAME_S)), slots[name]] = 0.9
                words = strip_speaker(line, names).split()
                step = dur / len(words)
                sentences.append(SimpleNamespace(tokens=[SimpleNamespace(text=" " + w, start=start + i * step,
                                                                         end=start + (i + 1) * step)
                                                         for i, w in enumerate(words)]))
            diar = fk.FakeDiar(truth=truth, oneshot_segments=[(s, s + d, slots[nm]) for s, d, nm in rows])
            return env_for(diar, ScriptedStt(SimpleNamespace(sentences=sentences)))

        raw = scratch / "raw"
        meeting = "IS1009a"                       # the replica's raw outputs exist for this meeting
        rmeta, rresult, rprobs, _ = ev.load_raw(meeting)
        with contextlib.redirect_stdout(io.StringIO()):        # the workers print one summary line each
            for n in DEMOS:
                run_worker(demo_env(n), f"demo_{n}", raw)
            for limit in (None, LIMITED_CACHE_GB):
                run_worker(env_for(fk.FakeDiar(truth=rprobs), ScriptedStt(rresult)), f"ami_{meeting}", raw, limit)
            run_compare(env_for(fk.FakeDiar(truth=fk.sticky_truth(fk.n_emb_for(200 * ev.SAMPLE_RATE)),
                                            oneshot_segments=[(1.0, 2.5, 0), (3.0, 4.0, 1)]), None), raw)
        for path in raw.glob("*.json"):
            if not path.name.endswith((".segments.json", ".stt.json")):
                mark_complete(path, {"wall_s": 1.0, "max_rss_bytes": 1e9, "peak_footprint_bytes": 2e9})

        summary = evaluate(raw, scratch / "out")
        report = scratch / "out/app_path_check.md"
        report.write_text("> **SELFTEST WITH FAKE MODELS: NOT A RESULT**\n\n" + report.read_text())
        runs = summary["runs"]
        assert set(runs) == {"demo_1", "demo_2", "demo_3", f"ami_{meeting}", f"ami_{meeting}_cache0.5"}, set(runs)
        threshold_s = fk.tv.diar_stream.STREAM_MIN_SECONDS
        assert [runs[f"demo_{n}"]["diarize_info"]["mode"] for n in DEMOS] == [
            "stream" if wav_frames(DEMO_DIR / f"meeting_{n}.wav") / ev.SAMPLE_RATE >= threshold_s else "oneshot"
            for n in DEMOS]
        for n in DEMOS:                           # fakes that reproduce the script: perfect scores
            r = runs[f"demo_{n}"]
            assert r["wer"]["wer"] == 0.0 and r["wer"]["n_hyp"] == r["wer"]["n_ref"], r["wer"]
            assert r["der"]["segments"]["skip_overlap=False"]["der"] < 0.01, r["der"]["segments"]
            assert r["der"]["words"]["skip_overlap=False"]["der"] < 0.05, r["der"]["words"]
            assert r["turns_rebuilt_equal"], n
            assert r["n_hyp_speakers"] == r["n_ref_speakers"] and r["frames"]["streamed"] in (r["frames"]["expected"], None)
        for name in (f"ami_{meeting}", f"ami_{meeting}_cache0.5"):   # fakes that are the replica: identical everywhere
            c = summary["ami_vs_replica"][name]
            assert runs[name]["diarize_info"]["mode"] == "stream" and runs[name]["frames"]["streamed"] == runs[name]["frames"]["expected"]
            assert c["probs_identical"] and c["segments_identical"] and c["transcript_words_identical"] and c["turns_identical"], c
            assert c["stt_tokens_identical"] and runs[name]["turns_rebuilt_equal"]
            assert c["frames_with_different_activity"] == 0 and c["probs_max_abs_diff"] == 0.0
            assert c["recomputed_equals_stored"] == {"wer": True, "der": True, "words_der": True}, c["recomputed_equals_stored"]
            w = c["replica_stored"]["words_der"]
            assert abs(runs[name]["der"]["words"]["skip_overlap=False"]["der"] - w["der"]) < 1e-9
            assert abs(runs[name]["wer"]["wer"] - c["replica_stored"]["wer"]["wer"]) < 1e-9
            assert abs(runs[name]["der"]["segments"]["skip_overlap=False"]["der"] - c["replica_stored"]["der"]["der"]) < 1e-9
        cmp_ = summary["mode_comparison"]
        assert len(cmp_["demos"]) == 6 and {d["mode"] for d in cmp_["demos"]} == {"stream", "oneshot"}
        assert [e["length_s"] for e in cmp_["clips_by_length"]] == list(CLIP_LENGTHS)
        avail = ev.complete_meetings()
        for e in cmp_["clips_by_length"]:
            expect = sum(1 for mt, starts in CLIP_STARTS.items() if mt in avail for st in starts
                         if st + e["length_s"] <= avail[mt])
            assert expect > 0 and all(e["modes"][m]["n_clips"] == expect for m in ("oneshot", "stream")), (e["length_s"], expect)
            assert e["delta_der"]["ci95"][0] <= e["delta_der"]["point"] <= e["delta_der"]["ci95"][1] + 1e-12, e["delta_der"]
        assert cmp_["threshold_suggestion_s"] in (None, *CLIP_LENGTHS), cmp_["threshold_suggestion_s"]
        assert summary["code_check"]["same_code_in_all_runs"] and not summary["code_check"]["runs_not_matching_files_now"]
        assert not summary["missing"], summary["missing"]
        assert summary["demo_pooled"]["wer"] == 0.0 and summary["demo_pooled"]["n_ref_words"] > 900
        assert summary["ami_selection"]["shortest_complete_min"][meeting] > 0
        fake_probe = scratch / "fake_probe.json"
        fake_probe.write_text(json.dumps({
            "clips": 45, "lengths_s": [30, 60, 120],
            "overall": {v: {"der": x} for v, x in (("oneshot", .39), ("original", .315), ("peaknorm", .314), ("minus20db", .321))},
            "paired_over_starts": [{"a": "oneshot", "b": "peaknorm", "delta_der": 0.076, "ci95": [0.009, 0.145]}]}))
        lp = probe_summary(fake_probe)
        assert lp["file"] == "fake_probe.md" and abs(lp["der"]["minus20db"] - .321) < 1e-12, lp
        assert any(b.startswith("Input level (supplementary probe `fake_probe.md`; 45 AMI clips of 30/60/120 s")
                   and "+7.6 points [+0.9, +14.5]" in b for b in summary_bullets(dict(summary, level_probe=lp)))
        assert summary["level_probe"] is None and probe_summary(scratch / "missing.json") is None
        assert not any(b.startswith("Input level") for b in summary_bullets(summary))
        out = json.loads((scratch / "out/app_path_check.json").read_text())
        md = (scratch / "out/app_path_check.md").read_text()
        assert out["runs"].keys() == runs.keys() and all(h in md for h in ("## 1.", "## 2.", "## 3.", "## 4.", "## 5."))
        assert (raw / "demo_1.hyp.txt").read_text().startswith("[") and (raw / "demo_1.stt.json").exists()
        assert bytecode_state() == pyc_before, "the dry run wrote bytecode into the app tree"
    finally:
        fk.tearDownModule()


# --------------------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("all", "run"):
        p = sub.add_parser(name, help="model passes" + (" and evaluation" if name == "all" else ""))
        p.add_argument("--force", action="store_true", help="redo runs that are already complete")
        p.add_argument("--only", default="", help="comma separated run names (demo_1, ami_<ID>, ami_<ID>_cache0.5, compare)")
        p.add_argument("--skip-limited", action="store_true", help="skip the run with the 0.5 GB MLX cache limit")
        p.add_argument("--skip-compare", action="store_true", help="skip the forced one-shot / streaming comparison")
        p.add_argument("--ami-meeting", default=None, help="AMI meeting id (default: the shortest complete one)")
        p.add_argument("--app-python", default=APP_PYTHON, help="interpreter of the model workers (the app's)")
    sub.add_parser("evaluate", help="metrics and report from the saved raw outputs (no model)")
    t = sub.add_parser("selftest", help="CPU-only check of the plumbing with fake models")
    t.add_argument("--keep", action="store_true", help="keep the scratch folder (dry-run outputs) for inspection")
    w = sub.add_parser("worker", help="(internal) one model process")
    w.add_argument("item", help="demo_N, ami_<ID> or compare")
    w.add_argument("--cache-limit-gb", type=float, default=None)
    a = ap.parse_args()

    if a.cmd == "worker":
        env = load_real_env()
        if a.item == "compare":
            run_compare(env, RAW_DIR)
        else:
            run_worker(env, a.item, RAW_DIR, a.cache_limit_gb)
    elif a.cmd == "selftest":
        selftest(a.keep)
    elif a.cmd == "evaluate":
        summary = evaluate()
        print(f"wrote {OUT_DIR / 'app_path_check.md'} and .json; missing: {summary['missing'] or 'none'}")
    else:
        if a.cmd == "all":
            ensure_metrics()                      # fail before the GPU work, not after it
        failures = cmd_run(a)
        if a.cmd == "all":
            summary = evaluate()
            print(f"wrote {OUT_DIR / 'app_path_check.md'} and .json; missing: {summary['missing'] or 'none'}")
        if failures:
            raise SystemExit(f"failed runs: {failures}")


if __name__ == "__main__":
    main()
