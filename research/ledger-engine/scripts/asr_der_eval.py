#!/usr/bin/env python3
"""Memoria ASR + diarization evaluation on the AMI Meeting Corpus (headset mix).

Pipeline under test = the app's post-recording path
(app/src-tauri/resources/python/transcribe_server.py::finalize and transcribe_v3.py):

    STT   mlx-community/parakeet-tdt-0.6b-v3                     stt.generate(audio, chunk_duration=120.0)
    DIAR  mlx-community/diar_streaming_sortformer_4spk-v2.1-fp16  threshold=0.5
    words/turns  aligned_words() + build_turns()   (copied verbatim from transcribe_v3.py, see below)

Diarization is run with the library's streaming API (chunk-wise, file mode) instead of the app's
literal one-shot `diar.generate()`, because the latter does not scale to whole meetings (see README:
O(T^2) memory and a 1500-frame positional table). The streaming path below is a memory-bounded replica
of `Sortformer.generate_stream()`; `verify-stream` proves it reproduces the library output.

Run with the evaluation venv (jiwer + pyannote.metrics live there):

    engine/.venv-asr/bin/python engine/scripts/asr_der_eval.py all
    ... run [--meetings A,B,...] [--n 8] [--force]   model passes only; one worker process per meeting, sequential
    ... evaluate                                      metrics + tables from saved raw outputs (no model is loaded)
    ... verify-stream MEETING                         bounded streaming == stock generate_stream (<= ~20 min audio)
    ... probe-generate                                app-literal diar.generate() on bounded excerpts (RAM-guarded)

Everything is resumable per meeting: raw model outputs are stored in results/asr/raw/ and a meeting is
skipped when its raw output already exists (use --force to recompute).
"""

import argparse
import datetime
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import threading
import time
import unicodedata
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path
from types import SimpleNamespace

import numpy as np
from scipy.io import wavfile

ROOT = Path("/Users/sayyid/Desktop/FYP")
AUDIO_DIR = ROOT / "data/ami/audio"
ANN_DIR = ROOT / "data/ami/annotations"
OUT_DIR = ROOT / "engine/results/asr"
RAW_DIR = OUT_DIR / "raw"
NORM_DIR = OUT_DIR / "normalised"
RTTM_DIR = OUT_DIR / "rttm"
SCRIPT = Path(__file__).resolve()

STT = "mlx-community/parakeet-tdt-0.6b-v3"
DIAR = "mlx-community/diar_streaming_sortformer_4spk-v2.1-fp16"
SPK_MODEL = "mlx-community/wespeaker-voxceleb-resnet34-LM"   # voice enrolment only; unused here
SAMPLE_RATE = 16000
STT_CHUNK_S = 120.0          # as in transcribe_server.finalize()
DIAR_THRESHOLD = 0.5         # as in transcribe_server.finalize()
STREAM_CHUNK_S = 5.0         # library default of generate_stream()
SPEAKERS = "ABCD"
WORKER_MEM_LIMIT_GB = 8.0    # worker aborts if MLX active memory exceeds this
MLX_CACHE_LIMIT_GB = 0.5     # bound MLX's allocator cache (default: unbounded) so the worker stays well below 8 GB on the shared machine
NS = "{http://nite.sourceforge.net/}"
FILLERS = {"hmm", "mm", "mhm", "mmm", "uh", "um"}   # Whisper EnglishTextNormalizer filler list (sensitivity only)


# --------------------------------------------------------------------------------------------------
# Code copied VERBATIM from app/src-tauri/resources/python/transcribe_v3.py (the app is not modified)
# --------------------------------------------------------------------------------------------------
def load_wav(path):
    rate, data = wavfile.read(path)
    assert rate == SAMPLE_RATE, f"expected 16kHz, got {rate}"
    if data.ndim > 1:
        data = data.mean(axis=1)
    if np.issubdtype(data.dtype, np.integer):
        data = data.astype(np.float32) / np.iinfo(data.dtype).max
    return data.astype(np.float32)


def words_from_tokens(tokens):
    """Flatten Parakeet subword tokens into words with timestamps."""
    words = []
    for t in tokens:
        if t.text.startswith(" ") or not words:
            words.append([t.start, t.end, t.text])
        else:                          # punctuation / sub-token glued to previous word
            words[-1][1] = t.end
            words[-1][2] += t.text
    return [(s, e, txt.strip()) for s, e, txt in words if txt.strip()]


def aligned_words(result, spk_segments, min_run_words=2, min_run_sec=0.5):
    """Per-word speakers, but snapped to sentence boundaries.

    Within each sentence, words are assigned to the sentence's dominant speaker
    unless the other speaker holds a real run (>= min_run_words and >= min_run_sec)
    — a genuine interruption. This keeps a lone boundary-straddling word (e.g. the
    final "plan?" of a question) with the speaker who actually said the sentence,
    instead of leaking it to whoever speaks next.
    """
    out_words, out_labels = [], []
    for sent in result.sentences:
        words = words_from_tokens(sent.tokens)
        if not words:
            continue
        labels = [speaker_at(s, e, spk_segments) for s, e, _ in words]
        dur = {}
        for (s, e, _), lab in zip(words, labels):
            dur[lab] = dur.get(lab, 0.0) + (e - s)
        dominant = max(dur, key=dur.get)
        i, n = 0, len(words)
        while i < n:                   # absorb insignificant minority runs into dominant
            j = i
            while j < n and labels[j] == labels[i]:
                j += 1
            run_dur = words[j - 1][1] - words[i][0]
            significant = (j - i) >= min_run_words and run_dur >= min_run_sec
            if labels[i] != dominant and not significant:
                for k in range(i, j):
                    labels[k] = dominant
            i = j
        out_words.extend(words)
        out_labels.extend(labels)
    return out_words, smooth(out_labels)


def speaker_at(t0, t1, spk_segments):
    """Speaker with the most overlap across the word window (overlap-aware);
    fall back to nearest segment if the word lands in a gap."""
    overlap = {}
    for d0, d1, spk in spk_segments:
        ov = max(0.0, min(t1, d1) - max(t0, d0))
        if ov > 0:
            overlap[spk] = overlap.get(spk, 0.0) + ov
    if overlap:
        return max(overlap, key=overlap.get)
    mid = (t0 + t1) / 2
    nearest, best_gap = None, 1e9
    for d0, d1, spk in spk_segments:
        gap = 0 if d0 <= mid <= d1 else min(abs(mid - d0), abs(mid - d1))
        if gap < best_gap:
            best_gap, nearest = gap, spk
    return nearest if nearest is not None else 0


def smooth(labels):
    """Reassign isolated single-word speaker islands to surrounding speaker."""
    out = labels[:]
    for i in range(1, len(out) - 1):
        if out[i] != out[i - 1] and out[i - 1] == out[i + 1]:
            out[i] = out[i - 1]
    return out


def build_turns(words, labels):
    turns = []
    for (s, e, txt), spk in zip(words, labels):
        if turns and turns[-1][2] == spk:
            turns[-1] = (turns[-1][0], e, spk, turns[-1][3] + " " + txt)
        else:
            turns.append((s, e, spk, txt))
    return turns


# --------------------------------------------------------------------------------------------------
# Model passes (worker process: one meeting, one process, models loaded once)
# --------------------------------------------------------------------------------------------------
def start_memory_guard(mx, limit_gb):
    """Abort the process if MLX active memory exceeds the budget (shared 16 GB machine)."""
    def loop():
        while True:
            if mx.get_active_memory() / 1e9 > limit_gb:
                print(f"MEMORY GUARD: MLX active memory > {limit_gb} GB -> abort", flush=True)
                os._exit(86)
            time.sleep(0.05)
    threading.Thread(target=loop, daemon=True).start()


def diarize_streaming(diar, audio, chunk_duration=STREAM_CHUNK_S, block_emb=750):
    """Memory-bounded replica of Sortformer.generate_stream() in file mode (v2.1 / use_aosc).

    The library pre-encodes the whole recording with the conv sub-sampler in one pass (~0.36 GB of
    transient MLX memory per minute of audio -> 6.3 GB for a 17.5 min meeting) only to obtain the
    one-frame right context of every chunk. Here the pre-encode is done block-wise (60 s blocks with
    a 2-frame left margin; the conv stack has a 15-frame receptive field so aligned blocks are exact).
    Everything else (mel features, chunking, streaming_step, state compression) is the library's own
    code. Returns frame-level speaker probabilities (n_frames, 4) at 80 ms per frame.
    """
    import mlx.core as mx
    from mlx_audio.vad.models.sortformer import sortformer as sf

    mc = diar.config.modules_config
    assert mc.use_aosc, "bounded replica implemented for the v2.1 (use_aosc) streaming model"
    proc = diar._processor_config
    waveform, _ = diar._load_audio(audio, SAMPLE_RATE)
    features = sf.extract_mel_features(
        waveform, sample_rate=proc.sampling_rate, n_fft=proc.n_fft, hop_length=proc.hop_length,
        win_length=proc.win_length, n_mels=proc.feature_size, preemphasis_coeff=proc.preemphasis,
        normalize=None, pad_to=0)
    total_mel = features.shape[2]
    sub = diar.config.fc_encoder_config.subsampling_factor
    chunk_mel = max(round(chunk_duration * proc.sampling_rate / proc.hop_length / sub) * sub, sub)
    spkcache_max = mc.spkcache_len
    fifo_max = mc.fifo_len if mc.fifo_len > 0 else 188
    rc = mc.chunk_right_context
    n_emb_total = -(-total_mel // sub)

    cache = {"lo": 0, "hi": 0, "base": 0, "embs": None}

    def pre_embs(a, b):
        b = min(b, n_emb_total)
        if cache["embs"] is None or a < cache["lo"] or b > cache["hi"]:
            s = max(0, a - 2)
            e = min(n_emb_total, a + block_emb + 2)
            mel_s, mel_e = s * sub, min(total_mel, e * sub)
            embs, _ = diar.fc_encoder.pre_encode(features[:, :, mel_s:mel_e], mx.array([mel_e - mel_s]))
            mx.eval(embs)
            cache.update(embs=embs, base=s, lo=(0 if s == 0 else s + 1), hi=e)
        return cache["embs"][:, a - cache["base"]: b - cache["base"], :]

    state = diar.init_streaming_state()
    probs, offset_mel, emb_offset = [], 0, 0
    while offset_mel < total_mel:
        end_mel = min(offset_mel + chunk_mel, total_mel)
        chunk_feat = features[:, :, offset_mel:end_mel]
        right_ctx = None
        if rc > 0:
            chunk_emb_len = -(-chunk_feat.shape[2] // sub)
            rc_start = emb_offset + chunk_emb_len
            rc_end = min(rc_start + rc, n_emb_total)
            if rc_end > rc_start:
                right_ctx = pre_embs(rc_start, rc_end)
            emb_offset += chunk_emb_len
        chunk_preds, state = diar.streaming_step(
            chunk_feat, mx.array([chunk_feat.shape[2]]), state, right_context_embs=right_ctx)
        probs.append(np.array(chunk_preds, dtype=np.float32))
        state = diar._maybe_compress_state(state, spkcache_max, fifo_max, mc)
        offset_mel = end_mel
    return np.concatenate(probs, axis=0)


def frame_duration_of(diar):
    proc = diar._processor_config
    return proc.hop_length * diar.config.fc_encoder_config.subsampling_factor / proc.sampling_rate


def probs_to_segments(probs, threshold, fd=0.08):
    """Threshold frame probabilities exactly like Sortformer._preds_to_segments (strict >), but over the
    whole recording (segments are not split at chunk boundaries)."""
    segs = []
    for spk in range(probs.shape[1]):
        act = (probs[:, spk] > threshold).astype(np.int8)
        d = np.diff(np.concatenate([[0], act, [0]]))
        for s, e in zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1)):
            segs.append((float(s * fd), float(e * fd), int(spk)))
    segs.sort(key=lambda x: (x[0], x[2]))
    return segs


def lib_versions():
    import importlib.metadata as md
    out = {"python": platform.python_version()}
    for pkg in ["mlx", "mlx-audio", "numpy", "scipy", "soundfile", "torch", "huggingface_hub",
                "jiwer", "pyannote.metrics", "pyannote.core"]:
        try:
            out[pkg] = md.version(pkg)
        except Exception:
            out[pkg] = None
    return out


def machine_info():
    def sh(cmd):
        try:
            return subprocess.run(cmd, capture_output=True, text=True, timeout=10).stdout.strip()
        except Exception:
            return None
    mem = sh(["sysctl", "-n", "hw.memsize"])
    return {"platform": platform.platform(), "chip": sh(["sysctl", "-n", "machdep.cpu.brand_string"]),
            "ram_gb": round(int(mem) / 2**30, 1) if mem else None}


def worker(meeting, chunk_s):
    import mlx.core as mx
    from mlx_audio.stt.utils import load as load_stt
    from mlx_audio.vad.utils import load_model as load_vad
    import resource

    start_memory_guard(mx, WORKER_MEM_LIMIT_GB)
    mx.set_cache_limit(int(MLX_CACHE_LIMIT_GB * 1e9))
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    audio = load_wav(AUDIO_DIR / f"{meeting}.wav")
    audio_s = len(audio) / SAMPLE_RATE

    t = time.time(); stt = load_stt(STT); t_load_stt = time.time() - t
    t = time.time(); diar = load_vad(DIAR); t_load_diar = time.time() - t

    # Warm-up on 20 s of the same recording so Metal kernel compilation is not counted in the RTF.
    t = time.time()
    warm = audio[: 20 * SAMPLE_RATE]
    stt.generate(mx.array(warm), chunk_duration=STT_CHUNK_S)
    diarize_streaming(diar, warm, chunk_s)
    t_warm = time.time() - t

    mx.reset_peak_memory()
    t = time.time()
    result = stt.generate(mx.array(audio), chunk_duration=STT_CHUNK_S)      # app call
    t_stt = time.time() - t
    stt_peak = mx.get_peak_memory()

    mx.clear_cache()
    mx.reset_peak_memory()
    t = time.time()
    probs = diarize_streaming(diar, audio, chunk_s)                          # streaming Sortformer
    t_diar = time.time() - t
    diar_peak = mx.get_peak_memory()

    sentences = [[[tok.text, float(tok.start), float(tok.end)] for tok in s.tokens] for s in result.sentences]
    (RAW_DIR / f"{meeting}.stt.json").write_text(json.dumps({"text": result.text, "sentences": sentences}))
    np.savez_compressed(RAW_DIR / f"{meeting}.diar.npz", probs=probs,
                        frame_duration=frame_duration_of(diar), chunk_s=chunk_s)
    meta = {
        "meeting": meeting, "audio_s": audio_s, "stt_model": STT, "diar_model": DIAR,
        "stt_chunk_s": STT_CHUNK_S, "diar_chunk_s": chunk_s, "diar_threshold": DIAR_THRESHOLD,
        "timing_s": {"load_stt": t_load_stt, "load_diar": t_load_diar, "warmup": t_warm,
                     "stt": t_stt, "diar": t_diar, "stt_plus_diar": t_stt + t_diar},
        "rtf": {"stt": t_stt / audio_s, "diar": t_diar / audio_s, "stt_plus_diar": (t_stt + t_diar) / audio_s},
        "mlx_peak_gb": {"stt": stt_peak / 1e9, "diar": diar_peak / 1e9},
        "mlx_cache_limit_gb": MLX_CACHE_LIMIT_GB,
        "ru_maxrss_gb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9,
        "n_tokens": sum(len(s) for s in sentences), "n_sentences": len(sentences),
        "n_diar_frames": int(probs.shape[0]),
        "finished": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "complete": False,   # set to True by the driver once process-level metrics are attached
    }
    (RAW_DIR / f"{meeting}.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps({k: meta[k] for k in ("meeting", "audio_s", "timing_s", "rtf", "mlx_peak_gb")}), flush=True)


# --------------------------------------------------------------------------------------------------
# Meeting selection + driver
# --------------------------------------------------------------------------------------------------
def complete_meetings():
    """{meeting: duration_s} for fully downloaded wavs (in-progress *.part files are ignored)."""
    import soundfile as sf
    out = {}
    for p in sorted(AUDIO_DIR.glob("*.wav")):
        try:
            info = sf.info(str(p))
        except Exception:
            continue
        if info.samplerate != SAMPLE_RATE or p.stat().st_size < 44 + 2 * info.frames * info.channels:
            continue
        m = p.stem
        if all((ANN_DIR / "words" / f"{m}.{s}.words.xml").exists()
               and (ANN_DIR / "segments" / f"{m}.{s}.segments.xml").exists() for s in SPEAKERS):
            out[m] = info.frames / info.samplerate
    return out


def team_of(meeting):
    return meeting[:-1]


def select_meetings(n):
    avail = complete_meetings()
    chosen = [m for m, _ in sorted(avail.items(), key=lambda kv: kv[1])[:n]]
    teams = {team_of(m) for m in chosen}
    if len(teams) < 4:
        print(f"WARNING: selection spans only {len(teams)} teams", file=sys.stderr)
    return chosen, avail


def parse_time_l(stderr_text):
    def grab(pat):
        m = re.search(pat, stderr_text, re.M)
        return float(m.group(1)) if m else None
    return {"wall_s": grab(r"^\s*([\d.]+)\s+real"),
            "max_rss_bytes": grab(r"^\s*(\d+)\s+maximum resident set size"),
            "peak_footprint_bytes": grab(r"^\s*(\d+)\s+peak memory footprint")}


def cmd_run(meetings, n, force, chunk_s):
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    avail = complete_meetings()
    chosen = meetings if meetings else select_meetings(n)[0]
    missing = [m for m in chosen if m not in avail]
    if missing:
        sys.exit(f"meetings not complete/available: {missing}")
    sel_path = RAW_DIR / "selection.json"
    prev_sel = json.loads(sel_path.read_text())["meetings"] if sel_path.exists() else []
    if meetings and set(chosen) <= set(prev_sel):
        print("re-running part of the existing selection:", ", ".join(chosen), flush=True)
    else:
        sel_path.write_text(json.dumps(
            {"meetings": chosen, "audio_s": {m: avail[m] for m in chosen}, "rule": "shortest complete meetings"
             if not meetings else "explicit list", "n": len(chosen),
             "selected_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds")}, indent=2))
        print("selected:", ", ".join(f"{m} ({avail[m] / 60:.1f} min)" for m in chosen), flush=True)
    for m in chosen:
        meta_path = RAW_DIR / f"{m}.json"
        if not force and meta_path.exists() and json.loads(meta_path.read_text()).get("complete"):
            print(f"[skip] {m} already processed", flush=True)
            continue
        if force and meta_path.exists():
            # keep the previous run: evaluate compares it with the new one (reproducibility, run-to-run speed)
            prev_dir = RAW_DIR / "previous_runs"
            prev_dir.mkdir(exist_ok=True)
            tag = datetime.datetime.fromtimestamp(meta_path.stat().st_mtime).strftime("%Y%m%d-%H%M%S")
            for suffix in (".json", ".stt.json", ".diar.npz", ".worker.log"):
                if (RAW_DIR / f"{m}{suffix}").exists():
                    shutil.copy2(RAW_DIR / f"{m}{suffix}", prev_dir / f"{m}.{tag}{suffix}")
        print(f"[run ] {m} ...", flush=True)
        t = time.time()
        proc = subprocess.run(["/usr/bin/time", "-l", sys.executable, str(SCRIPT), "worker", m,
                               "--chunk", str(chunk_s)], capture_output=True, text=True)
        (RAW_DIR / f"{m}.worker.log").write_text(proc.stdout + "\n--- stderr ---\n" + proc.stderr)
        if proc.returncode != 0 or not meta_path.exists():
            print(f"[FAIL] {m}: exit {proc.returncode} (see raw/{m}.worker.log)", flush=True)
            continue
        meta = json.loads(meta_path.read_text())
        meta["process"] = parse_time_l(proc.stderr)
        meta["complete"] = True
        meta_path.write_text(json.dumps(meta, indent=2))
        print(f"[done] {m}: {time.time() - t:.0f}s wall, RTF(stt+diar)={meta['rtf']['stt_plus_diar']:.4f}, "
              f"peak footprint={(meta['process']['peak_footprint_bytes'] or 0) / 1e9:.2f} GB", flush=True)


# --------------------------------------------------------------------------------------------------
# Reference (AMI NXT annotations)
# --------------------------------------------------------------------------------------------------
_APOS = str.maketrans({"\u2019": "'", "\u2018": "'", "\u02bc": "'", "\u00b4": "'", "`": "'"})
_TAG = re.compile(r"[\[{<][^\]}>]*[\]}>]")
_DELETE = re.compile(r"[.,?!;:\"()\[\]{}\u2026\u201c\u201d\u00ab\u00bb_]")
_SPLIT = re.compile(r"[^\w']+")


def norm_tokens(text):
    """Symmetric text normalisation for reference and hypothesis words.

    NFKC, lowercase, typographic apostrophes -> ', non-lexical {tags} dropped, sentence punctuation and
    underscores deleted (AMI spells acronyms T_V_ -> tv), any other symbol (hyphen, slash, ...) separates
    tokens (uh-huh -> uh huh, user-friendly -> user friendly), leading/trailing apostrophes stripped.
    No number, spelling or contraction expansion.
    """
    t = unicodedata.normalize("NFKC", text).translate(_APOS).lower()
    t = _TAG.sub(" ", t)
    t = _DELETE.sub("", t)
    return [x for x in (p.strip("'") for p in _SPLIT.split(t)) if x]


def load_reference(meeting):
    """Lexical words (no punctuation tokens, vocalsounds, gaps, disfluency markers) and segments of all
    four AMI participants."""
    words, segments = [], []
    for spk in SPEAKERS:
        root = ET.parse(ANN_DIR / "words" / f"{meeting}.{spk}.words.xml").getroot()
        order, lex = [], {}
        for el in root:
            wid = el.get(NS + "id")
            if wid is None:
                continue
            order.append(wid)
            text = (el.text or "").strip()
            if el.tag == "w" and el.get("punc") != "true" and text and el.get("starttime") and el.get("endtime"):
                lex[wid] = {"spk": spk, "id": wid, "start": float(el.get("starttime")),
                            "end": float(el.get("endtime")), "text": text, "trunc": el.get("trunc") == "true"}
        pos = {w: i for i, w in enumerate(order)}
        words.extend(lex.values())
        seg_root = ET.parse(ANN_DIR / "segments" / f"{meeting}.{spk}.segments.xml").getroot()
        for seg in seg_root:
            if seg.tag != "segment":
                continue
            ids, n_children = [], 0
            for ch in seg:
                href = ch.get("href") or ""
                m = re.search(r"#id\(([^)]+)\)(?:\.\.id\(([^)]+)\))?", href)
                if not m:
                    continue
                n_children += 1
                a, b = m.group(1), m.group(2) or m.group(1)
                if a in pos and b in pos:
                    ids.extend(order[pos[a]: pos[b] + 1])
            lex_ids = [i for i in ids if i in lex]
            st, en = seg.get("transcriber_start"), seg.get("transcriber_end")
            if st is None or en is None:
                ts = [lex[i]["start"] for i in lex_ids]
                te = [lex[i]["end"] for i in lex_ids]
                if not ts:
                    continue
                st, en = min(ts), max(te)
            segments.append({"spk": spk, "start": float(st), "end": float(en),
                             "n_lex": len(lex_ids), "lex_ids": lex_ids})
    return {"words": words, "segments": segments}


def ref_word_stream(ref, order="time"):
    """Single reference word stream (all speakers). order='time': by word start time (primary);
    order='segment': utterance by utterance (segments sorted by start, words in segment order)."""
    if order == "time":
        ws = sorted(ref["words"], key=lambda w: (w["start"], w["end"]))
        return ws, 0
    by_id = {(w["spk"], w["id"]): w for w in ref["words"]}
    used, items = set(), []
    for s in sorted(ref["segments"], key=lambda s: (s["start"], s["end"])):
        ws = []
        for i in s["lex_ids"]:
            k = (s["spk"], i)
            if k in by_id and k not in used:
                used.add(k)
                ws.append(by_id[k])
        if ws:
            items.append((s["start"], ws))
    leftovers = [w for k, w in by_id.items() if k not in used]
    for w in leftovers:
        items.append((w["start"], [w]))
    items.sort(key=lambda x: x[0])
    return [w for _, ws in items for w in ws], len(leftovers)


def merge_intervals(ivs, gap):
    out = []
    for a, b in sorted(ivs):
        if b <= a:
            continue
        if out and a - out[-1][1] <= gap:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def ref_annotation(ref, meeting, kind, gap):
    """kind: 'seg_lex' (segments containing >=1 lexical word; primary), 'seg_all' (all segments, incl.
    vocalsound-only ones), 'words' (union of word intervals). Same-speaker pieces closer than `gap`
    seconds are merged into one speech turn."""
    from pyannote.core import Annotation, Segment
    per = defaultdict(list)
    if kind == "words":
        for w in ref["words"]:
            per[w["spk"]].append((w["start"], w["end"]))
    else:
        for s in ref["segments"]:
            if kind == "seg_lex" and s["n_lex"] == 0:
                continue
            per[s["spk"]].append((s["start"], s["end"]))
    ann = Annotation(uri=meeting)
    for spk, ivs in per.items():
        for a, b in merge_intervals(ivs, gap):
            ann[Segment(a, b), spk] = spk
    return ann


def hyp_annotation(segs, meeting):
    from pyannote.core import Annotation, Segment
    ann = Annotation(uri=meeting)
    for a, b, s in segs:
        if b > a:
            ann[Segment(a, b), f"S{s}"] = f"S{s}"
    return ann


# --------------------------------------------------------------------------------------------------
# Metrics
# --------------------------------------------------------------------------------------------------
def wer_stats(ref_toks, hyp_toks):
    import jiwer
    out = jiwer.process_words(" ".join(ref_toks), " ".join(hyp_toks))
    n = out.hits + out.substitutions + out.deletions
    return out, {"n_ref": n, "n_hyp": len(hyp_toks), "S": out.substitutions, "D": out.deletions,
                 "I": out.insertions, "H": out.hits, "wer": out.wer}


def timing_offsets(out, ref_times, hyp_times):
    """Start-time differences (hyp - ref) of words matched 'equal' by the WER alignment (sanity check
    of the absolute time alignment between audio and annotation)."""
    d = []
    for ch in out.alignments[0]:
        if ch.type == "equal":
            for i in range(ch.ref_end_idx - ch.ref_start_idx):
                d.append(hyp_times[ch.hyp_start_idx + i] - ref_times[ch.ref_start_idx + i])
    return np.array(d)


def der_components(ref_ann, hyp_ann, dur, collar, skip_overlap):
    from pyannote.core import Segment, Timeline
    from pyannote.metrics.diarization import DiarizationErrorRate
    metric = DiarizationErrorRate(collar=collar, skip_overlap=skip_overlap)
    d = metric(ref_ann, hyp_ann, uem=Timeline([Segment(0.0, dur)]), detailed=True)
    return {"total_s": d["total"], "miss_s": d["missed detection"], "fa_s": d["false alarm"],
            "conf_s": d["confusion"], "correct_s": d["correct"]}


def der_key(ref, thr, collar, skip, hyp="sortformer"):
    return f"hyp={hyp}|ref={ref}|thr={thr}|collar={collar}|skip_overlap={skip}"


PRIMARY_DER_KEY = der_key("seg_lex_gap0.3", 0.5, 0.25, False)


def load_raw(meeting):
    meta = json.loads((RAW_DIR / f"{meeting}.json").read_text())
    stt = json.loads((RAW_DIR / f"{meeting}.stt.json").read_text())
    npz = np.load(RAW_DIR / f"{meeting}.diar.npz")
    result = SimpleNamespace(text=stt["text"], sentences=[
        SimpleNamespace(tokens=[SimpleNamespace(text=t, start=s, end=e) for t, s, e in sent])
        for sent in stt["sentences"]])
    return meta, result, npz["probs"], float(npz["frame_duration"])


def reproducibility(meeting, probs):
    """Compare the current raw outputs with earlier runs of the same meeting kept in raw/previous_runs/."""
    prev_dir = RAW_DIR / "previous_runs"
    if not prev_dir.exists():
        return []
    cur_stt = json.loads((RAW_DIR / f"{meeting}.stt.json").read_text())
    cur_tok = [t for sent in cur_stt["sentences"] for t in sent]
    out = []
    for pj in sorted(prev_dir.glob(f"{meeting}.*.json")):
        if pj.name.endswith(".stt.json"):
            continue
        tag = pj.name[len(meeting) + 1: -len(".json")]
        pm = json.loads(pj.read_text())
        entry = {"previous_run": tag, "previous_finished": pm.get("finished"), "previous_rtf": pm.get("rtf"),
                 "previous_mlx_cache_limit_gb": pm.get("mlx_cache_limit_gb"),
                 "previous_peak_footprint_gb": ((pm.get("process") or {}).get("peak_footprint_bytes") or 0) / 1e9}
        sp, dp = prev_dir / f"{meeting}.{tag}.stt.json", prev_dir / f"{meeting}.{tag}.diar.npz"
        if sp.exists():
            prev_tok = [t for sent in json.loads(sp.read_text())["sentences"] for t in sent]
            entry["stt_texts_identical"] = [t[0] for t in prev_tok] == [t[0] for t in cur_tok]
            if len(prev_tok) == len(cur_tok):
                entry["stt_max_abs_timestamp_diff_s"] = float(max(
                    [max(abs(a[1] - b[1]), abs(a[2] - b[2])) for a, b in zip(prev_tok, cur_tok)] or [0.0]))
        if dp.exists():
            pp = np.load(dp)["probs"]
            entry["diar_same_shape"] = bool(pp.shape == probs.shape)
            if pp.shape == probs.shape:
                entry["diar_max_abs_prob_diff"] = float(np.abs(pp - probs).max())
        out.append(entry)
    return out


def miss_diagnostics(meeting, ref, probs, fd):
    """Why is missed speech high? Audio level (dBFS per 80 ms frame) of the frames inside reference words that
    the model left silent, compared with frames the model marks as speech and with frames silent in both."""
    audio = load_wav(AUDIO_DIR / f"{meeting}.wav")
    hop = int(round(fd * SAMPLE_RATE))
    n = min(probs.shape[0], len(audio) // hop)
    x = audio[: n * hop].reshape(n, hop)
    db = 10 * np.log10((x ** 2).mean(1) + 1e-12)
    hyp_on = (probs[:n] > DIAR_THRESHOLD).any(axis=1)
    word_on = np.zeros(n, bool)
    for w in ref["words"]:
        word_on[int(w["start"] / fd): min(int(np.ceil(w["end"] / fd)), n)] = True
    mids = np.array([(w["start"] + w["end"]) / 2 for w in ref["words"]])
    idx = np.clip((mids / fd).astype(int), 0, n - 1)
    silent_both = ~word_on & ~hyp_on
    missed, detected = word_on & ~hyp_on, word_on & hyp_on
    sil_p90 = float(np.percentile(db[silent_both], 90))
    return {
        "frame_s": fd,
        "ref_words_with_hyp_speech_at_midpoint": float(hyp_on[idx].mean()),
        "ref_word_frames_hyp_silent_s": float(missed.sum() * fd),
        "ref_word_frames_hyp_active_s": float(detected.sum() * fd),
        "median_dbfs": {"silent_in_ref_and_hyp": float(np.median(db[silent_both])),
                        "ref_word_and_hyp_speech": float(np.median(db[detected])),
                        "ref_word_but_hyp_silent": float(np.median(db[missed]))},
        "silent_in_ref_and_hyp_p90_dbfs": sil_p90,
        "frac_hyp_silent_word_frames_above_silence_p90": float(np.mean(db[missed] > sil_p90)),
        "frac_hyp_speech_word_frames_above_silence_p90": float(np.mean(db[detected] > sil_p90))}


def evaluate_meeting(meeting):
    meta, result, probs, fd = load_raw(meeting)
    dur = meta["audio_s"]
    ref = load_reference(meeting)

    # ---- hypothesis exactly as the app builds it (aligned_words / build_turns) ----
    spk_segments = probs_to_segments(probs, DIAR_THRESHOLD, fd)
    words, labels = aligned_words(result, spk_segments)
    turns = build_turns(words, labels)
    hyp_items = [(tok, s) for s, _, txt in words for tok in norm_tokens(txt)]
    hyp_tok = [t for t, _ in hyp_items]
    hyp_time = [s for _, s in hyp_items]

    # ---- WER ----
    def ref_items_for(order):
        ws, leftover = ref_word_stream(ref, order)
        items = [(tok, w["start"], w["trunc"]) for w in ws for tok in norm_tokens(w["text"])]
        return items, leftover

    variants = {}
    for name, order, drop_frag, drop_fill in [
            ("primary", "time", False, False), ("segment_order", "segment", False, False),
            ("no_fragments", "time", True, False), ("no_fillers", "time", False, True),
            ("no_fragments_no_fillers", "time", True, True)]:
        items, leftover = ref_items_for(order)
        if drop_frag:
            items = [it for it in items if not it[2]]
        h_tok, h_time = hyp_tok, hyp_time
        if drop_fill:
            items = [it for it in items if it[0] not in FILLERS]
            keep = [i for i, t in enumerate(hyp_tok) if t not in FILLERS]
            h_tok, h_time = [hyp_tok[i] for i in keep], [hyp_time[i] for i in keep]
        out, st = wer_stats([i[0] for i in items], h_tok)
        variants[name] = st
        if name == "primary":
            d = timing_offsets(out, [i[1] for i in items], h_time)
            ref_primary = [i[0] for i in items]
            st["match_offset_s"] = {
                "n": int(d.size), "median": float(np.median(d)), "p05": float(np.percentile(d, 5)),
                "p95": float(np.percentile(d, 95)), "frac_within_1s": float(np.mean(np.abs(d) <= 1.0))}
            sub_words = [(ref_primary[ch.ref_start_idx + i], h_tok[ch.hyp_start_idx + i])
                         for ch in out.alignments[0] if ch.type == "substitute"
                         for i in range(min(ch.ref_end_idx - ch.ref_start_idx, ch.hyp_end_idx - ch.hyp_start_idx))]
            del_words = [ref_primary[i] for ch in out.alignments[0] if ch.type == "delete"
                         for i in range(ch.ref_start_idx, ch.ref_end_idx)]
            ins_words = [h_tok[i] for ch in out.alignments[0] if ch.type == "insert"
                         for i in range(ch.hyp_start_idx, ch.hyp_end_idx)]
            n_frag = sum(1 for it in items if it[2])
            n_fill = sum(1 for it in items if it[0] in FILLERS)
            st["ref_fragment_tokens"] = n_frag
            st["ref_filler_tokens"] = n_fill
            st["deleted_filler_tokens"] = sum(1 for w in del_words if w in FILLERS)
            st["hyp_digit_token_rate"] = float(np.mean([any(c.isdigit() for c in t) for t in hyp_tok]))
            st["ref_digit_token_rate"] = float(np.mean([any(c.isdigit() for c in t) for t in ref_primary]))
            st["ref_segment_order_leftover_words"] = ref_items_for("segment")[1]
            from collections import Counter
            st["top_substitutions"] = [[a, b, c] for (a, b), c in Counter(sub_words).most_common(15)]
            st["top_deletions"] = [[w, c] for w, c in Counter(del_words).most_common(15)]
            st["top_insertions"] = [[w, c] for w, c in Counter(ins_words).most_common(15)]

    # ---- DER ----
    refs = {"seg_lex_gap0.3": ref_annotation(ref, meeting, "seg_lex", 0.3),
            "seg_lex_gap0.0": ref_annotation(ref, meeting, "seg_lex", 0.0),
            "seg_all_gap0.3": ref_annotation(ref, meeting, "seg_all", 0.3),
            "words_gap0.3": ref_annotation(ref, meeting, "words", 0.3)}
    hyps = {thr: hyp_annotation(probs_to_segments(probs, thr, fd), meeting) for thr in (0.5, 0.4, 0.3)}
    der = {}
    for thr in (0.5, 0.4, 0.3):
        for collar in (0.25, 0.5, 0.0):
            for skip in (False, True):
                der[der_key("seg_lex_gap0.3", thr, collar, skip)] = der_components(
                    refs["seg_lex_gap0.3"], hyps[thr], dur, collar, skip)
    for rname in ("seg_lex_gap0.0", "seg_all_gap0.3", "words_gap0.3"):
        for collar in (0.25, 0.5):
            for skip in (False, True):
                der[der_key(rname, 0.5, collar, skip)] = der_components(refs[rname], hyps[0.5], dur, collar, skip)
    # what the app finally shows: the speaker label of every transcribed word (words of one speaker closer than 0.3 s merged)
    from pyannote.core import Annotation, Segment
    word_ivs = defaultdict(list)
    for (s, e, _), lab in zip(words, labels):
        word_ivs[lab].append((s, e))
    app_ann = Annotation(uri=meeting)
    for lab, ivs in word_ivs.items():
        for a, b in merge_intervals(ivs, 0.3):
            app_ann[Segment(a, b), f"S{lab}"] = f"S{lab}"
    for collar in (0.25, 0.5):
        for skip in (False, True):
            der[der_key("seg_lex_gap0.3", 0.5, collar, skip, hyp="app_words")] = der_components(
                refs["seg_lex_gap0.3"], app_ann, dur, collar, skip)

    stock_check = None
    stock_path = RAW_DIR / f"{meeting}.stock_generate_stream_segments.json"
    if stock_path.exists():
        stock_segs = [(a, b, int(k)) for a, b, k in json.loads(stock_path.read_text())]
        nfr = probs.shape[0]

        def raster(segs):
            m = np.zeros((nfr, 4), bool)
            for a, b, k in segs:
                m[int(round(a / fd)): int(round(b / fd)), k] = True
            return m
        stock_check = {
            "frame_agreement_all_speakers": float((raster(stock_segs) == raster(spk_segments)).all(axis=1).mean()),
            "der_stock_generate_stream": {f"collar{c}": der_rates(der_components(
                refs["seg_lex_gap0.3"], hyp_annotation(stock_segs, meeting), dur, c, False)) for c in (0.25, 0.5)},
            "der_bounded_replica": {f"collar{c}": der_rates(
                der[der_key("seg_lex_gap0.3", 0.5, c, False)]) for c in (0.25, 0.5)}}

    prim = refs["seg_lex_gap0.3"]
    ref_speech = prim.get_timeline().support().duration()
    ref_overlap = prim.get_overlap().duration()
    ref_info = {
        "n_ref_words_lexical": len(ref["words"]), "n_ref_segments": len(ref["segments"]),
        "n_ref_segments_lexical": sum(1 for s in ref["segments"] if s["n_lex"] > 0),
        "ref_speech_s": ref_speech, "ref_overlap_s": ref_overlap,
        "ref_overlap_fraction": ref_overlap / ref_speech if ref_speech else None,
        "ref_speaker_speech_s": {k: float(v) for k, v in prim.chart()},
        "n_hyp_speakers": len({s for *_, s in spk_segments}),
        "hyp_speech_s": hyps[0.5].get_timeline().support().duration(),
    }

    # ---- artefacts ----
    NORM_DIR.mkdir(parents=True, exist_ok=True)
    RTTM_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / f"hyp_{meeting}.txt").write_text(
        "\n".join(f"[{s:.1f}s - {e:.1f}s] Speaker {spk}: {txt}" for s, e, spk, txt in turns) + "\n")
    (NORM_DIR / f"ref_{meeting}.txt").write_text(" ".join(ref_primary) + "\n")
    (NORM_DIR / f"hyp_{meeting}.txt").write_text(" ".join(hyp_tok) + "\n")
    with open(RTTM_DIR / f"ref_{meeting}.rttm", "w") as f:
        prim.write_rttm(f)
    with open(RTTM_DIR / f"hyp_{meeting}.rttm", "w") as f:
        hyps[0.5].write_rttm(f)

    return {"meeting": meeting, "team": team_of(meeting), "audio_s": dur, "audio_min": dur / 60,
            "wer": variants, "der": der, "reference": ref_info, "speed": {
                "timing_s": meta["timing_s"], "rtf": meta["rtf"], "mlx_peak_gb": meta["mlx_peak_gb"],
                "process": meta.get("process"), "ru_maxrss_gb": meta.get("ru_maxrss_gb"),
                "mlx_cache_limit_gb": meta.get("mlx_cache_limit_gb")},
            "n_hyp_words": len(words), "n_turns": len(turns), "stock_stream_crosscheck": stock_check,
            "miss_diagnostics": miss_diagnostics(meeting, ref, probs, fd),
            "reproducibility": reproducibility(meeting, probs)}


def pool_wer(rows, variant):
    S = sum(r["wer"][variant]["S"] for r in rows)
    D = sum(r["wer"][variant]["D"] for r in rows)
    I = sum(r["wer"][variant]["I"] for r in rows)
    H = sum(r["wer"][variant]["H"] for r in rows)
    N = S + D + H
    return {"n_ref": N, "S": S, "D": D, "I": I, "H": H, "wer": (S + D + I) / N}


def pool_der(rows, key):
    tot = sum(r["der"][key]["total_s"] for r in rows)
    m = sum(r["der"][key]["miss_s"] for r in rows)
    fa = sum(r["der"][key]["fa_s"] for r in rows)
    c = sum(r["der"][key]["conf_s"] for r in rows)
    return {"total_s": tot, "miss_s": m, "fa_s": fa, "conf_s": c,
            "der": (m + fa + c) / tot, "miss": m / tot, "fa": fa / tot, "conf": c / tot}


def der_rates(c):
    t = c["total_s"]
    return {"der": (c["miss_s"] + c["fa_s"] + c["conf_s"]) / t, "miss": c["miss_s"] / t,
            "fa": c["fa_s"] / t, "conf": c["conf_s"] / t}


# --------------------------------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------------------------------
def pc(x, nd=1):
    return f"{100 * x:.{nd}f}"


def build_tables(rows, pooled):
    k_p = PRIMARY_DER_KEY
    k_so = der_key("seg_lex_gap0.3", 0.5, 0.25, True)
    lines = ["| Meeting | Team | Min | WER % | S | D | I | DER % | Miss % | FA % | Conf % | DER % (skip overlap) | RTF |",
             "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for r in rows:
        w, d, ds = r["wer"]["primary"], der_rates(r["der"][k_p]), der_rates(r["der"][k_so])
        lines.append(f"| {r['meeting']} | {r['team']} | {r['audio_min']:.1f} | {pc(w['wer'])} | {w['S']} | {w['D']} | "
                     f"{w['I']} | {pc(d['der'])} | {pc(d['miss'])} | {pc(d['fa'])} | {pc(d['conf'])} | "
                     f"{pc(ds['der'])} | {r['speed']['rtf']['stt_plus_diar']:.4f} |")
    pw, pd_, pds = pooled["wer"]["primary"], pooled["der"][k_p], pooled["der"][k_so]
    mins = sum(r["audio_min"] for r in rows)
    lines.append(f"| **Pooled** | {len({r['team'] for r in rows})} teams | {mins:.1f} | **{pc(pw['wer'])}** | {pw['S']} | "
                 f"{pw['D']} | {pw['I']} | **{pc(pd_['der'])}** | {pc(pd_['miss'])} | {pc(pd_['fa'])} | {pc(pd_['conf'])} | "
                 f"{pc(pds['der'])} | {pooled['rtf']['stt_plus_diar']:.4f} |")
    mean = lambda f: float(np.mean([f(r) for r in rows]))
    lines.append(f"| Mean of meetings | | {mins / len(rows):.1f} | {pc(mean(lambda r: r['wer']['primary']['wer']))} | | | | "
                 f"{pc(mean(lambda r: der_rates(r['der'][k_p])['der']))} | {pc(mean(lambda r: der_rates(r['der'][k_p])['miss']))} | "
                 f"{pc(mean(lambda r: der_rates(r['der'][k_p])['fa']))} | {pc(mean(lambda r: der_rates(r['der'][k_p])['conf']))} | "
                 f"{pc(mean(lambda r: der_rates(r['der'][k_so])['der']))} | {mean(lambda r: r['speed']['rtf']['stt_plus_diar']):.4f} |")
    main = "\n".join(lines)

    sp = ["| Meeting | Audio s | STT s | Diar s | STT+Diar s | Process wall s (incl. model load + warm-up) | RTF STT | RTF Diar | RTF total | Peak mem footprint GB | MLX peak GB (STT / Diar) | MLX cache limit |",
          "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|"]
    for r in rows:
        s, p = r["speed"], r["speed"]["process"] or {}
        fp = (p.get("peak_footprint_bytes") or 0) / 1e9
        sp.append(f"| {r['meeting']} | {r['audio_s']:.0f} | {s['timing_s']['stt']:.1f} | {s['timing_s']['diar']:.1f} | "
                  f"{s['timing_s']['stt_plus_diar']:.1f} | {p.get('wall_s') or float('nan'):.0f} | {s['rtf']['stt']:.4f} | {s['rtf']['diar']:.4f} | "
                  f"{s['rtf']['stt_plus_diar']:.4f} | {fp:.2f} | {s['mlx_peak_gb']['stt']:.2f} / {s['mlx_peak_gb']['diar']:.2f} | "
                  f"{('%.1f GB' % s['mlx_cache_limit_gb']) if s.get('mlx_cache_limit_gb') else 'default (unbounded)'} |")
    pr = pooled["rtf"]
    sp.append(f"| **Pooled** | {pooled['audio_s']:.0f} | {pooled['stt_s']:.1f} | {pooled['diar_s']:.1f} | "
              f"{pooled['stt_s'] + pooled['diar_s']:.1f} | {sum((r['speed']['process'] or {}).get('wall_s') or 0 for r in rows):.0f} | "
              f"{pr['stt']:.4f} | {pr['diar']:.4f} | {pr['stt_plus_diar']:.4f} | max {pooled['max_peak_footprint_gb']:.2f} | | |")
    speed = "\n".join(sp)

    sens = ["| WER variant (pooled) | WER % | S | D | I |", "|---|---:|---:|---:|---:|"]
    labels = {"primary": "primary (ref ordered by word start time, all lexical tokens)",
              "segment_order": "reference ordered utterance-by-utterance",
              "no_fragments": "truncated-word fragments removed from reference",
              "no_fillers": "uh/um/mm/mhm/mmm/hmm removed from both",
              "no_fragments_no_fillers": "fragments + fillers removed"}
    for name, lab in labels.items():
        w = pooled["wer"][name]
        sens.append(f"| {lab} | {pc(w['wer'])} | {w['S']} | {w['D']} | {w['I']} |")
    sens_w = "\n".join(sens)

    def row(label, key):
        d = pooled["der"][key]
        return f"| {label} | {pc(d['der'])} | {pc(d['miss'])} | {pc(d['fa'])} | {pc(d['conf'])} |"
    hdr = ["| DER variant (pooled) | DER % | Miss % | FA % | Conf % |", "|---|---:|---:|---:|---:|"]
    rows_d = [
        ("**primary**: collar 0.25, overlap scored, thr 0.5, segments ref", PRIMARY_DER_KEY),
        ("collar 0.25, overlap skipped", der_key("seg_lex_gap0.3", 0.5, 0.25, True)),
        ("collar 0.5 (= NIST +-0.25 s), overlap scored", der_key("seg_lex_gap0.3", 0.5, 0.5, False)),
        ("collar 0.5 (= NIST +-0.25 s), overlap skipped", der_key("seg_lex_gap0.3", 0.5, 0.5, True)),
        ("no collar, overlap scored", der_key("seg_lex_gap0.3", 0.5, 0.0, False)),
        ("no collar, overlap skipped", der_key("seg_lex_gap0.3", 0.5, 0.0, True)),
        ("threshold 0.4, collar 0.25, overlap scored", der_key("seg_lex_gap0.3", 0.4, 0.25, False)),
        ("threshold 0.3, collar 0.25, overlap scored", der_key("seg_lex_gap0.3", 0.3, 0.25, False)),
        ("ref: no merging of same-speaker segments (gap 0), collar 0.25", der_key("seg_lex_gap0.0", 0.5, 0.25, False)),
        ("ref: incl. vocalsound-only segments, collar 0.25", der_key("seg_all_gap0.3", 0.5, 0.25, False)),
        ("ref: word-timing speech (merge 0.3 s), collar 0.25", der_key("words_gap0.3", 0.5, 0.25, False)),
        ("ref: word-timing speech (merge 0.3 s), collar 0.5, overlap skipped", der_key("words_gap0.3", 0.5, 0.5, True)),
        ("hyp = app's final per-word speaker labels (aligned_words; only transcribed words count as speech), collar 0.25",
         der_key("seg_lex_gap0.3", 0.5, 0.25, False, hyp="app_words")),
        ("hyp = app's final per-word speaker labels, collar 0.25, overlap skipped",
         der_key("seg_lex_gap0.3", 0.5, 0.25, True, hyp="app_words")),
    ]
    sens_d = "\n".join(hdr + [row(l, k) for l, k in rows_d])
    return main, speed, sens_w, sens_d


def aggregate(rows):
    pooled = {"wer": {v: pool_wer(rows, v) for v in rows[0]["wer"]},
              "der": {k: pool_der(rows, k) for k in rows[0]["der"]}}
    audio = sum(r["audio_s"] for r in rows)
    stt = sum(r["speed"]["timing_s"]["stt"] for r in rows)
    diar = sum(r["speed"]["timing_s"]["diar"] for r in rows)
    pooled.update({
        "audio_s": audio, "audio_min": audio / 60, "stt_s": stt, "diar_s": diar,
        "rtf": {"stt": stt / audio, "diar": diar / audio, "stt_plus_diar": (stt + diar) / audio},
        "max_peak_footprint_gb": max(((r["speed"]["process"] or {}).get("peak_footprint_bytes") or 0) / 1e9 for r in rows),
        "max_peak_footprint_gb_default_cache": max([((r["speed"]["process"] or {}).get("peak_footprint_bytes") or 0) / 1e9
                                                    for r in rows if not r["speed"].get("mlx_cache_limit_gb")] or [None],
                                                   key=lambda v: -1 if v is None else v),
        "max_peak_footprint_gb_limited_cache": max([((r["speed"]["process"] or {}).get("peak_footprint_bytes") or 0) / 1e9
                                                    for r in rows if r["speed"].get("mlx_cache_limit_gb")] or [None],
                                                   key=lambda v: -1 if v is None else v),
        "n_meetings": len(rows), "teams": sorted({r["team"] for r in rows}),
        "ref_speech_s": sum(r["reference"]["ref_speech_s"] for r in rows),
        "ref_overlap_s": sum(r["reference"]["ref_overlap_s"] for r in rows)})
    pooled["ref_overlap_fraction"] = pooled["ref_overlap_s"] / pooled["ref_speech_s"]
    macro = {}
    k = PRIMARY_DER_KEY
    macro["wer"] = {"mean": float(np.mean([r["wer"]["primary"]["wer"] for r in rows])),
                    "std": float(np.std([r["wer"]["primary"]["wer"] for r in rows]))}
    macro["der"] = {"mean": float(np.mean([der_rates(r["der"][k])["der"] for r in rows])),
                    "std": float(np.std([der_rates(r["der"][k])["der"] for r in rows]))}
    pooled["macro_mean"] = macro
    return pooled


def load_probe():
    p = OUT_DIR / "app_generate_probe.json"
    return json.loads(p.read_text()) if p.exists() else None


def write_readme(rows, pooled, main, speed, sens_w, sens_d, now):
    pw, k = pooled["wer"]["primary"], PRIMARY_DER_KEY
    pdr, pdo = pooled["der"][k], pooled["der"][der_key("seg_lex_gap0.3", 0.5, 0.25, True)]
    pdn = pooled["der"][der_key("seg_lex_gap0.3", 0.5, 0.5, False)]
    pdw = pooled["der"][der_key("words_gap0.3", 0.5, 0.25, False)]
    meet = ", ".join(f"{r['meeting']} ({r['audio_min']:.1f} min)" for r in rows)
    probe = load_probe()
    probe_txt = ""
    if probe:
        lines = ["| excerpt (ES2004a) | `diar.generate()` peak MLX GB | `generate()` DER % / speakers found | streaming DER % / speakers found |",
                 "|---|---:|---:|---:|"]
        for e in probe["excerpts"]:
            lines.append(f"| {e['start_s']:.0f}-{e['start_s'] + e['length_s']:.0f} s | {e['generate']['mlx_peak_gb']:.2f} | "
                         f"{pc(e['generate']['der']['der'])} / {e['generate']['n_speakers']} | "
                         f"{pc(e['stream']['der']['der'])} / {e['stream']['n_speakers']} |")
        probe_txt = ("\n\nMeasured on bounded excerpts (collar 0.25, overlap scored; `app_generate_probe.json`; the full-meeting "
                     "one-shot call was deliberately not run: extrapolated peak "
                     f"~{probe['extrapolated_peak_gb_full_ES2004a']:.0f} GB for the 17.5 min ES2004a, far above the 8 GB budget):\n\n"
                     + "\n".join(lines))
    ver_path = OUT_DIR / "stream_verification.json"
    verify_txt = ""
    if ver_path.exists():
        v = json.loads(ver_path.read_text())
        dd = v["der_collar0.25_overlap_scored"]
        verify_txt += (
            f"Equivalence check (`verify-stream {v['meeting']} --seconds {v['audio_s']:.0f}`, stock `generate_stream` vs replica on the first "
            f"{v['audio_s']:.0f} s): frame probabilities differ by at most {v['max_abs_prob_diff']:.2f} "
            f"({pc(v['frac_frames_abs_diff_gt_0.05'])} % of frames by more than 0.05), the thresholded active-speaker decision differs on "
            f"{pc(v['frac_frames_active_decision_differs'])} % of frames, DER {pc(dd['stock_generate_stream']['der'])} % (stock) vs "
            f"{pc(dd['bounded_replica']['der'])} % (replica). The replica's block-wise conv pre-encode differs from the one-shot pre-encode by ~1e-4 "
            f"(relative ~1e-6); the speaker-cache selection amplifies this, so the two agree closely but not bit-exactly "
            f"(stock `generate_stream` itself is deterministic run-to-run). ")
    for r in rows:
        c = r.get("stock_stream_crosscheck")
        if c:
            verify_txt += (
                f"Cross-check on the full {r['meeting']} ({r['audio_min']:.1f} min), stock `generate_stream` output saved earlier "
                f"(`raw/{r['meeting']}.stock_generate_stream_segments.json`): frame-wise identical speaker activity on "
                f"{pc(c['frame_agreement_all_speakers'])} % of frames, DER (collar 0.25, overlap scored) "
                f"{pc(c['der_stock_generate_stream']['collar0.25']['der'])} % (stock) vs {pc(c['der_bounded_replica']['collar0.25']['der'])} % (replica). ")
    mem_parts = []
    if pooled.get("max_peak_footprint_gb_default_cache") is not None:
        mem_parts.append(f"up to {pooled['max_peak_footprint_gb_default_cache']:.1f} GB with MLX's default allocator cache")
    if pooled.get("max_peak_footprint_gb_limited_cache") is not None:
        mem_parts.append(f"up to {pooled['max_peak_footprint_gb_limited_cache']:.1f} GB with a {MLX_CACHE_LIMIT_GB:.1f} GB cache limit")
    mem_txt = "; ".join(mem_parts)
    avail = complete_meetings()
    rest = sorted((d, m) for m, d in avail.items() if m not in [r["meeting"] for r in rows])
    by_team = defaultdict(list)
    for m in sorted(avail):
        by_team[team_of(m)].append(m[-1])
    sel_txt = (f"{len(avail)} complete meetings were available ({', '.join(f'{t}[{chr(44).join(v)}]' for t, v in by_team.items())}); the "
               f"{len(rows)} shortest were evaluated ({len(rows)} is the lower end of the requested 6-8: the machine was shared and heavily "
               f"loaded, so more meetings did not fit the time budget). The next shortest, not evaluated, are "
               + ", ".join(f"{m} ({d / 60:.1f} min)" for d, m in rest[:3]) + ". "
               f"IS1009 contributes two of the meetings (same four speakers, different session).")
    rtf_best = min(((r["meeting"], r["speed"]["rtf"]["stt_plus_diar"]) for r in rows), key=lambda x: x[1])
    rtf_worst = max(((r["meeting"], r["speed"]["rtf"]["stt_plus_diar"]) for r in rows), key=lambda x: x[1])
    rep = [(r, e) for r in rows for e in r.get("reproducibility", [])]
    repro_txt = ""
    if rep:
        rl = ["| Meeting | transcript tokens identical | max abs timestamp diff (s) | max abs diff of Sortformer frame probabilities | RTF total first run -> re-run | peak footprint GB first run -> re-run | MLX cache limit first run -> re-run |",
              "|---|---|---:|---:|---|---|---|"]
        for r, e in rep:
            lim = lambda v: ("%.1f GB" % v) if v else "default"
            rl.append(f"| {r['meeting']} | {'yes' if e.get('stt_texts_identical') else 'NO'} | "
                      f"{e.get('stt_max_abs_timestamp_diff_s', float('nan')):.3g} | {e.get('diar_max_abs_prob_diff', float('nan')):.3g} | "
                      f"{e['previous_rtf']['stt_plus_diar']:.3f} -> {r['speed']['rtf']['stt_plus_diar']:.3f} | "
                      f"{e['previous_peak_footprint_gb']:.2f} -> {((r['speed']['process'] or {}).get('peak_footprint_bytes') or 0) / 1e9:.2f} | "
                      f"{lim(e['previous_mlx_cache_limit_gb'])} -> {lim(r['speed'].get('mlx_cache_limit_gb'))} |")
        repro_txt = ("**Re-runs.** Meetings that were processed twice keep their first run in `raw/previous_runs/`; `evaluate` compares "
                     "it with the final run (these re-runs only changed the MLX cache policy and the machine load):\n\n" + "\n".join(rl))
    mt = ["| Meeting | ref words with model speech at word midpoint | ref-word time the model leaves silent (s) | median dBFS: ref word + model speech | median dBFS: ref word, model silent | median dBFS: silent in both | model-silent word frames louder than 90 % of the silent-in-both frames |",
          "|---|---:|---:|---:|---:|---:|---:|"]
    for r in rows:
        d = r["miss_diagnostics"]
        md = d["median_dbfs"]
        mt.append(f"| {r['meeting']} | {pc(d['ref_words_with_hyp_speech_at_midpoint'])} % | {d['ref_word_frames_hyp_silent_s']:.0f} | "
                  f"{md['ref_word_and_hyp_speech']:.1f} | {md['ref_word_but_hyp_silent']:.1f} | {md['silent_in_ref_and_hyp']:.1f} | "
                  f"{pc(d['frac_hyp_silent_word_frames_above_silence_p90'])} % |")
    miss_tbl = "\n".join(mt)
    k_scored, k_noov = PRIMARY_DER_KEY, der_key("seg_lex_gap0.3", 0.5, 0.25, True)
    m_all, m_non = (sum(r["der"][k]["miss_s"] for r in rows) for k in (k_scored, k_noov))
    t_all, t_non = (sum(r["der"][k]["total_s"] for r in rows) for k in (k_scored, k_noov))
    ov_txt = (f"Overlapped speech accounts for a further part: {m_all - m_non:.0f} s ({pc((m_all - m_non) / m_all, 0)} %) of the "
              f"{m_all:.0f} s of missed time (collar 0.25) lies where >= 2 reference speakers talk at once, although that is only "
              f"{pc((t_all - t_non) / t_all, 0)} % of the scored reference speaker time (miss rate there {pc((m_all - m_non) / (t_all - t_non), 0)} % "
              f"versus {pc(m_non / t_non, 0)} % in non-overlapped speech). The audible, non-overlapped remainder was not characterised further.")
    rs, rd = [r["speed"]["rtf"]["stt"] for r in rows], [r["speed"]["rtf"]["diar"] for r in rows]
    ms, md = [r["speed"]["mlx_peak_gb"]["stt"] for r in rows], [r["speed"]["mlx_peak_gb"]["diar"] for r in rows]
    text = f"""# Memoria live-transcription pipeline on AMI: WER / DER / speed

Generated by `engine/scripts/asr_der_eval.py` on {now}. Numbers: `wer_der_table.md`, raw numbers: `results.json`.

## What was evaluated
* STT: `{STT}` via `stt.generate(audio, chunk_duration=120.0)` (the app's post-recording call in
  `transcribe_server.finalize()` / `transcribe_v3.py`), English only. The hypothesis is the app's word stream
  (`aligned_words()` output). `hyp_<MEETING>.txt` is the app's final speaker-turn transcript (`build_turns()`);
  `normalised/hyp_<M>.txt` / `normalised/ref_<M>.txt` are the exact token streams that were scored.
* Diarization: `{DIAR}`, threshold 0.5 (as in the app), at most 4 speakers.
  Run with the library's streaming API (`generate_stream` file mode, 5 s chunks, speaker cache 188 + FIFO 188), see "Deviation".
* Audio: AMI headset mix (`Mix-Headset`, 16 kHz mono) of {len(rows)} meetings = the shortest complete meetings of the official AMI
  unseen/evaluation teams: {meet}; **{pooled['audio_min']:.1f} min** ({pooled['audio_min'] / 60:.2f} h) over
  {len(pooled['teams'])} teams ({', '.join(pooled['teams'])}). AMI is CC BY 4.0.
* Reference: AMI manual annotations v1.6.2 (NXT `words/` and `segments/`).

## Results at a glance (pooled over all meetings; sums of errors / sums of reference)
* **WER {pc(pw['wer'])} %** (S {pw['S']}, D {pw['D']}, I {pw['I']}, N = {pw['n_ref']} reference words).
* **DER {pc(pdr['der'])} %** = missed speech {pc(pdr['miss'])} % + false alarm {pc(pdr['fa'])} % + speaker confusion {pc(pdr['conf'])} %
  (collar 0.25 s, overlap scored). With overlap skipped: {pc(pdo['der'])} %. With the NIST-style +-0.25 s collar
  (pyannote `collar=0.5`): {pc(pdn['der'])} %. Against a word-timing reference instead of the segment reference: {pc(pdw['der'])} %.
* **RTF {pooled['rtf']['stt_plus_diar']:.3f}** (STT {pooled['rtf']['stt']:.3f} + diarization {pooled['rtf']['diar']:.3f}), i.e. about
  {1 / pooled['rtf']['stt_plus_diar']:.1f}x faster than real time, measured while the GPU/RAM were shared with other jobs (see caveats);
  peak process memory footprint {mem_txt} (includes MLX's allocator cache; MLX active-memory peaks are lower, see speed table).
* Reference overlap: {pc(pooled['ref_overlap_fraction'])} % of the reference speech time has >= 2 simultaneous speakers.

## How the numbers were computed
**Selection.** `run` lists `data/ami/audio/*.wav` (in-progress `*.part` downloads ignored), verifies the WAV header against the
file size, takes the shortest complete meetings and requires >= 4 teams (team = meeting id without the letter; ES = Edinburgh,
IS = Idiap, TS = TNO recording sites). {sel_txt}

**WER.** Reference = every lexical `<w>` of the four participants (punctuation tokens `punc="true"`, `vocalsound`, `gap`, `disfmarker`
elements removed), merged into one stream ordered by word start time. Hypothesis = the words of the app. Both sides use the same
normalisation (`norm_tokens`): NFKC, lower-case, typographic apostrophes -> `'`, sentence punctuation deleted, `_` deleted (AMI spells
acronyms `T_V_` -> `tv`), any other symbol (e.g. hyphen) splits tokens (`uh-huh` -> `uh huh`, `user-friendly` -> `user friendly`),
leading/trailing apostrophes stripped; nothing is expanded (no number, contraction or spelling normalisation) and disfluency
fragments (`trunc="true"`), fillers and back-channels are kept. Scoring: `jiwer.process_words` (Levenshtein, S/D/I/hits); WER = (S+D+I)/N
with N = reference words; pooled WER = summed errors / summed N (not the mean of per-meeting WERs). Sensitivities (pooled):

{sens_w}

**DER.** Reference = AMI `segments` of each participant, restricted to segments that contain >= 1 lexical word (vocalsound-only
segments dropped), same-speaker segments closer than 0.3 s merged into one turn; evaluated region (UEM) = whole recording.
Hypothesis = Sortformer speaker-activity segments (frame probability > 0.5, 80 ms frames). `pyannote.metrics.diarization.DiarizationErrorRate`
(optimal one-to-one speaker mapping per meeting, done by the metric), `detailed=True`; miss / false alarm / confusion are given as a
percentage of the total scored reference speaker time (pyannote's `total`: overlapped speech counts once per active speaker, time inside
the collar is not scored). Pooled DER = summed error time / summed scored reference speaker time.
*Collar semantics:* `collar=0.25` (the setting requested) is pyannote's total width, i.e. +-0.125 s around every reference boundary;
the NIST md-eval "0.25 s collar" (+-0.25 s) corresponds to pyannote `collar=0.5` and is reported as a sensitivity. `skip_overlap=True`
removes all time with >= 2 reference speakers from scoring. Sensitivities (pooled):

{sens_d}

**Speed.** One worker process per meeting, run strictly sequentially; both models stay loaded as in the app. A 20 s warm-up pass
(Metal kernel compilation) is excluded. RTF = processing seconds / audio seconds, with the STT call and the diarization pass timed
separately and summed (they run one after the other, as in `finalize()`); model loading is reported separately in `raw/<M>.json`.
Peak memory = "peak memory footprint" from `/usr/bin/time -l` (includes the unified-memory GPU buffers MLX allocates, unlike
max-RSS) plus MLX's own `get_peak_memory()` per stage. MLX's default allocator cache is unbounded and keeps freed buffers for reuse, so
the footprint of a run exceeds the memory actually needed; the first meetings were run with that default, then (after the footprint of
one of them exceeded the 8 GB budget and the machine started swapping) the worker was changed to `mx.set_cache_limit(0.5 GB)` plus
`mx.clear_cache()` between the STT and diarization stages. The policy used is listed per meeting in the last column of the speed table;
it does not change any output (WER/DER) of the models. Hardware: {machine_info()['chip']}, {machine_info()['ram_gb']} GB RAM.

{speed}

{repro_txt}

## Where the missed speech comes from
In every meeting false alarm and confusion are small and missed speech dominates the DER. To check whether the model fails to hear
speech or the reference calls near-silent time "speech", `miss_diagnostics` (in `results.json`) compares the audio level (dBFS of the
headset mix, 80 ms frames) of frames inside reference words that the model marks as speech, frames inside reference words that it leaves
silent, and frames that are silent in both:

{miss_tbl}

The frames the model leaves silent inside reference words are, in the median, much closer in level to the frames that are silent in both
than to the frames it marks as speech, and only the share in the last column is louder than 90 % of the silent-in-both frames. So a large
part of the "missed speech" is reference time without audible speech (most likely forced-alignment padding around words, and pauses and
breaths inside the annotators' utterance segments), not speech the model failed to detect. {ov_txt} At word level the model has speech active at
the midpoint of the share of reference words given in the first column. This is why the word-timing reference and the wider collar
(sensitivities above) give a lower DER than the segment reference requested for the main table.

## Deviation from the app's literal diarization call (important)
The app calls `diar.generate(mx.array(audio), threshold=0.5)` once over the whole recording. In mlx-audio 0.4.3 that is a single
full-sequence forward pass over all 12.5 frames/s: the FastConformer uses relative-position self-attention (a heads x N x (2N-1) score
matrix per layer), so memory grows quadratically with the recording length, and the model's Transformer encoder has only
`max_source_positions = 1500` frames (= 120 s) in its config. On this shared 16 GB machine that call cannot process a 14-30 min meeting,
and in the probes below the speaker assignment degrades as soon as the input exceeds ~2 min.{probe_txt}

The evaluation therefore uses the library's streaming API (chunk-wise, speaker cache + FIFO, the mode the v2.1 model was built for).
`diarize_streaming()` is a replica of `Sortformer.generate_stream()` file mode (mel features, 5 s chunking, speaker-cache/FIFO update and
state compression are the library's own code); it only changes how the convolutional pre-encode, needed for the one-frame right context of
each chunk, is batched: in 60 s blocks instead of over the whole recording, because the stock version needs ~0.36 GB of MLX memory per
audio minute (5.1 GB measured for the 14 min IS1009a, which does not fit the 8 GB budget for the 25-30 min meetings).
{verify_txt}
Consequence: the DER here is that of the model with its intended streaming inference, **not** what the app's current `finalize()` call would
deliver on a long recording; the app should switch to `generate_stream` (or chunked inference).

## Independent checks of the metric code (done once during development with throw-away scripts, not part of this script)
* WER: a pure-Python word-level Levenshtein on the same normalised token streams reproduced `jiwer`'s error counts exactly
  (IS1009a, ES2014a, TS3003a).
* DER: a numpy frame-level DER (collar 0, Hungarian speaker mapping) agreed with `pyannote.metrics` within 0.01 percentage points
  (ES2004a, ES2014a, TS3003a).
* Re-running a meeting reproduces the transcript tokens, timestamps and Sortformer probabilities bit-exactly (table "Re-runs" above).

## Caveats
* Headset-mix audio is near-field, clean, close-talk speech (the sum of the four individual headset microphones). Real far-field / laptop
  recording conditions would be worse for both WER and DER.
* English-only evaluation; Parakeet-TDT-0.6b-v3 is multilingual but no Malay (or code-switched) speech was tested.
* AMI manual words include disfluencies, fragments, laughs-as-words and back-channels (`mm-hmm`, `uh`, `um`), a large share of which
  Parakeet does not transcribe (deletions). AMI is spontaneous, heavily overlapping speech (see overlap share above); during overlap a
  single-stream ASR can output only one talker, which produces deletions. The single-stream reference ordering for overlapped speech is
  a convention (see `segment_order` sensitivity).
* Numbers are not expanded: the AMI reference spells numbers out, the hypothesis may contain digits (digit-token rate per meeting is in
  `results.json`), which counts as substitution/insertion/deletion errors.
* Reference segment boundaries are looser than the acoustic speech (transcribers' timing), which inflates *missed speech*; the
  word-timing reference and the wider collar bound this effect (see DER sensitivities).
* Sortformer supports at most 4 speakers (AMI has exactly 4 participants per meeting, so this is not a limit here).
* Only the post-recording (`finalize`) path is evaluated, not the live partial-transcription path (VAD-segmented, incremental).
* The WER/DER of a model run is deterministic here, but the sample is small ({len(rows)} meetings, {pooled['audio_min']:.0f} min); per-meeting
  spread is shown in the table (mean +- std of per-meeting WER {pc(pooled['macro_mean']['wer']['mean'])} +- {pc(pooled['macro_mean']['wer']['std'])} %,
  DER {pc(pooled['macro_mean']['der']['mean'])} +- {pc(pooled['macro_mean']['der']['std'])} %).
* Speed was measured on a shared machine: other processes (another agent's Python/MLX jobs, browser, WindowServer) used the GPU and RAM at the same time (machine under memory pressure, several GB of swap in use at times), so RTFs are pessimistic and vary with load: the combined RTF ranged from {rtf_best[1]:.3f} ({rtf_best[0]}) to {rtf_worst[1]:.3f} ({rtf_worst[0]}) for the same code, so treat the pooled value as an upper bound and the best value as closer to an idle machine. Per-stage RTF ranged from {min(rs):.3f} to {max(rs):.3f} (STT) and from {min(rd):.3f} to {max(rd):.3f} (diarization).
* MLX active-memory peak per stage (speed table): {min(ms):.1f}-{max(ms):.1f} GB for the STT stage (`stt.generate(..., chunk_duration=120)`) and {min(md):.1f}-{max(md):.1f} GB for the diarization stage, which grows with the recording length; both models stay loaded as in the app, so each stage's peak includes the other model's weights.

## Re-running
```
engine/.venv-asr/bin/python engine/scripts/asr_der_eval.py all                 # select, run (resumable), evaluate
engine/.venv-asr/bin/python engine/scripts/asr_der_eval.py run --meetings IS1009a --force   # (re)process one meeting
engine/.venv-asr/bin/python engine/scripts/asr_der_eval.py evaluate            # recompute metrics from raw/
engine/.venv-asr/bin/python engine/scripts/asr_der_eval.py verify-stream ES2004a
engine/.venv-asr/bin/python engine/scripts/asr_der_eval.py probe-generate
```
Files: `wer_der_table.md`, `results.json`, `hyp_<M>.txt`, `normalised/{{ref,hyp}}_<M>.txt`, `rttm/{{ref,hyp}}_<M>.rttm` (primary DER
reference / Sortformer thr 0.5), `raw/` (tokens with timestamps, Sortformer frame probabilities, timings, worker logs),
`app_generate_probe.json`, `stream_verification.json`.
"""
    (OUT_DIR / "README.md").write_text(text)


def cmd_evaluate():
    sel = RAW_DIR / "selection.json"
    if sel.exists():
        meetings = json.loads(sel.read_text())["meetings"]
    else:
        meetings = sorted(p.stem for p in RAW_DIR.glob("*.json") if p.stem != "selection" and "." not in p.stem)
    meetings = [m for m in meetings if (RAW_DIR / f"{m}.json").exists()
                and json.loads((RAW_DIR / f"{m}.json").read_text()).get("complete")]
    if not meetings:
        sys.exit("no completed meetings in raw/ - run first")
    rows = []
    for m in meetings:
        t = time.time()
        rows.append(evaluate_meeting(m))
        print(f"[eval] {m}: WER {pc(rows[-1]['wer']['primary']['wer'])}  DER {pc(der_rates(rows[-1]['der'][PRIMARY_DER_KEY])['der'])}  ({time.time() - t:.0f}s)", flush=True)
    pooled = aggregate(rows)
    main, speed, sens_w, sens_d = build_tables(rows, pooled)
    now = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    md = f"""# Memoria pipeline on AMI (headset mix): WER and DER

Pipeline: Parakeet-TDT-0.6b-v3 (STT) + Sortformer-4spk-v2.1 streaming (diarization), MLX, {machine_info()['chip']}.
{len(rows)} meetings, {pooled['audio_min']:.1f} min, teams: {', '.join(pooled['teams'])}. Generated {now}.

## Main table

WER: lower-cased, punctuation stripped, nothing expanded, all four speakers merged in word-start-time order, `jiwer`; S/D/I = counts of
substitutions/deletions/insertions (percentages are relative to the reference words). DER: `pyannote.metrics` `DiarizationErrorRate`,
collar 0.25 (pyannote semantics: +-0.125 s), overlap scored, reference = AMI manual segments (merged at 0.3 s); Miss/FA/Conf are % of
the scored reference speaker time (overlap counted once per speaker); "skip overlap" = same but ignoring all overlapped reference speech. RTF = (STT + diarization seconds) / audio seconds.

{main}

## Speed and memory

{speed}

## Sensitivity analyses (pooled)

{sens_w}

{sens_d}

See README.md for definitions and caveats.
"""
    (OUT_DIR / "wer_der_table.md").write_text(md)
    results = {
        "generated": now,
        "task": "Memoria live-transcription pipeline evaluated on AMI headset mix",
        "parameters": {
            "stt_model": STT, "diar_model": DIAR, "speaker_embedding_model_unused": SPK_MODEL,
            "stt_call": f"stt.generate(mx.array(audio), chunk_duration={STT_CHUNK_S})",
            "diarization_call": "Sortformer streaming (generate_stream file mode, memory-bounded replica), "
                                f"chunk {STREAM_CHUNK_S} s, spkcache 188, fifo 188, right context 1 frame, frame 0.08 s, threshold {DIAR_THRESHOLD}",
            "primary_der": {"collar": 0.25, "skip_overlap": False, "threshold": DIAR_THRESHOLD,
                            "reference": "AMI segments with >=1 lexical word, same-speaker gap<=0.3 s merged",
                            "uem": "[0, wav duration]", "collar_semantics": "pyannote: total width, +-collar/2"},
            "text_normalisation": norm_tokens.__doc__.strip().split("\n"),
            "fillers_for_sensitivity": sorted(FILLERS),
            "audio": "AMI Mix-Headset 16 kHz mono; annotations AMI manual v1.6.2 (NXT)",
            "selection_rule": "shortest complete meetings (<= requested n), >= 4 teams",
        },
        "libraries": lib_versions(), "machine": machine_info(),
        "meetings": rows, "pooled": pooled,
        "app_generate_probe": load_probe(),
        "stream_verification": (json.loads((OUT_DIR / "stream_verification.json").read_text())
                                if (OUT_DIR / "stream_verification.json").exists() else None),
    }
    (OUT_DIR / "results.json").write_text(json.dumps(results, indent=2))
    write_readme(rows, pooled, main, speed, sens_w, sens_d, now)
    print(main)
    print(f"\nwrote {OUT_DIR}/wer_der_table.md, results.json, README.md, hyp_*.txt")


# --------------------------------------------------------------------------------------------------
# Verification / probe sub-commands
# --------------------------------------------------------------------------------------------------
def cmd_verify_stream(meeting, seconds):
    """Bounded streaming replica vs stock Sortformer.generate_stream() on the same audio
    (optionally only the first `seconds` seconds: the stock pre-encode needs ~0.36 GB per audio minute)."""
    import mlx.core as mx
    from mlx_audio.vad.utils import load_model as load_vad
    start_memory_guard(mx, WORKER_MEM_LIMIT_GB)
    audio = load_wav(AUDIO_DIR / f"{meeting}.wav")
    if seconds:
        audio = audio[: int(seconds * SAMPLE_RATE)]
    dur = len(audio) / SAMPLE_RATE
    diar = load_vad(DIAR)
    fd = frame_duration_of(diar)
    mx.reset_peak_memory()
    t = time.time()
    probs_b = diarize_streaming(diar, audio)
    t_b, peak_b = time.time() - t, mx.get_peak_memory() / 1e9
    mx.reset_peak_memory()
    t = time.time()
    chunks = []
    for out in diar.generate_stream(mx.array(audio), chunk_duration=STREAM_CHUNK_S, threshold=DIAR_THRESHOLD):
        chunks.append(np.array(out.speaker_probs, dtype=np.float32))
    t_s, peak_s = time.time() - t, mx.get_peak_memory() / 1e9
    probs_s = np.concatenate(chunks, 0)
    n = min(len(probs_b), len(probs_s))
    diff = np.abs(probs_b[:n] - probs_s[:n]).max(axis=1)
    flips = ((probs_b[:n] > DIAR_THRESHOLD) != (probs_s[:n] > DIAR_THRESHOLD)).any(axis=1)
    ref_ann = ref_annotation(load_reference(meeting), meeting, "seg_lex", 0.3)
    ders = {name: der_rates(der_components(ref_ann, hyp_annotation(probs_to_segments(p, DIAR_THRESHOLD, fd), meeting),
                                           dur, 0.25, False))
            for name, p in (("bounded_replica", probs_b), ("stock_generate_stream", probs_s))}
    res = {"meeting": meeting, "audio_s": dur, "frames_bounded": int(probs_b.shape[0]), "frames_stock": int(probs_s.shape[0]),
           "max_abs_prob_diff": float(diff.max()), "frac_frames_abs_diff_gt_0.001": float((diff > 1e-3).mean()),
           "frac_frames_abs_diff_gt_0.05": float((diff > 0.05).mean()), "frac_frames_active_decision_differs": float(flips.mean()),
           "first_frame_diff_gt_0.001": int(np.argmax(diff > 1e-3)) if (diff > 1e-3).any() else None,
           "der_collar0.25_overlap_scored": ders,
           "seconds_wall": {"bounded_replica": t_b, "stock_generate_stream": t_s},
           "mlx_peak_gb": {"bounded_replica": peak_b, "stock_generate_stream": peak_s},
           "note": "stock generate_stream is deterministic run-to-run (checked: identical output twice); the replica's conv "
                   "pre-encode is computed in blocks, whose float32 results differ from the one-shot pre-encode by ~1e-4 "
                   "(relative ~1e-6); this perturbation is amplified by the speaker-cache selection, so the two outputs "
                   "agree closely but not bit-exactly."}
    (OUT_DIR / "stream_verification.json").write_text(json.dumps(res, indent=2))
    print(json.dumps(res, indent=2))


def cmd_probe_generate():
    """App-literal diar.generate() on bounded excerpts vs streaming on the same excerpts (RAM-guarded)."""
    import mlx.core as mx
    from mlx_audio.vad.utils import load_model as load_vad
    start_memory_guard(mx, 7.0)
    mx.set_memory_limit(int(7.0e9))
    meeting = "ES2004a"
    audio = load_wav(AUDIO_DIR / f"{meeting}.wav")
    diar = load_vad(DIAR)
    ref = load_reference(meeting)
    ref_ann = ref_annotation(ref, meeting, "seg_lex", 0.3)
    base = diar.generate(mx.array(audio[: 10 * SAMPLE_RATE]), threshold=DIAR_THRESHOLD)   # warm-up
    excerpts = []
    for start, length in [(180, 60), (180, 120), (600, 120), (180, 300)]:
        seg = audio[int(start * SAMPLE_RATE): int((start + length) * SAMPLE_RATE)]
        entry = {"start_s": start, "length_s": length}
        from pyannote.core import Segment, Timeline
        from pyannote.metrics.diarization import DiarizationErrorRate
        uem = Timeline([Segment(start, start + length)])

        def score(segs):
            out = {}
            for name, skip in (("der", False), ("der_skip_overlap", True)):
                d = DiarizationErrorRate(collar=0.25, skip_overlap=skip)(
                    ref_ann, hyp_annotation(segs, meeting), uem=uem, detailed=True)
                out[name] = der_rates({"total_s": d["total"], "miss_s": d["missed detection"],
                                       "fa_s": d["false alarm"], "conf_s": d["confusion"]})
            return out

        mx.clear_cache(); mx.reset_peak_memory(); t = time.time()
        dia = diar.generate(mx.array(seg), threshold=DIAR_THRESHOLD)
        t_g = time.time() - t
        g_segs = [(d.start + start, d.end + start, d.speaker) for d in dia.segments]
        entry["generate"] = {"seconds": t_g, "mlx_peak_gb": mx.get_peak_memory() / 1e9,
                             "n_speakers": len({s for *_, s in g_segs}), **score(g_segs)}
        mx.clear_cache(); mx.reset_peak_memory(); t = time.time()
        probs = diarize_streaming(diar, seg)
        t_s = time.time() - t
        s_segs = [(a + start, b + start, s) for a, b, s in probs_to_segments(probs, DIAR_THRESHOLD, frame_duration_of(diar))]
        entry["stream"] = {"seconds": t_s, "mlx_peak_gb": mx.get_peak_memory() / 1e9,
                           "n_speakers": len({s for *_, s in s_segs}), **score(s_segs)}
        excerpts.append(entry)
        print(json.dumps({k: entry[k] for k in ("start_s", "length_s")}),
              f"generate peak {entry['generate']['mlx_peak_gb']:.2f} GB DER {pc(entry['generate']['der']['der'])}%"
              f" spk={entry['generate']['n_speakers']} | stream DER {pc(entry['stream']['der']['der'])}%"
              f" spk={entry['stream']['n_speakers']}", flush=True)
    # peak ~ weights + c * T^2 (attention over T frames); fit on the measured excerpts, extrapolate (not measured)
    T = np.array([e["length_s"] * 12.5 for e in excerpts])
    P = np.array([e["generate"]["mlx_peak_gb"] for e in excerpts])
    A = np.vstack([np.ones_like(T), T ** 2]).T
    (a, c), *_ = np.linalg.lstsq(A, P, rcond=None)
    full = len(audio) / SAMPLE_RATE * 12.5
    res = {"meeting": meeting, "note": "app-literal diar.generate() (one-shot) vs streaming on the same excerpts; "
           "excerpt DER over the excerpt only, so few-speaker excerpts are noisy",
           "excerpts": excerpts, "fit_peak_gb": {"intercept": float(a), "per_frame_sq": float(c)},
           "extrapolated_peak_gb_full_ES2004a": float(a + c * full ** 2)}
    (OUT_DIR / "app_generate_probe.json").write_text(json.dumps(res, indent=2))


# --------------------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("run", "all"):
        p = sub.add_parser(name)
        p.add_argument("--meetings", default="", help="comma separated ids (default: shortest n complete)")
        p.add_argument("--n", type=int, default=8)
        p.add_argument("--force", action="store_true")
        p.add_argument("--chunk", type=float, default=STREAM_CHUNK_S)
    sub.add_parser("evaluate")
    w = sub.add_parser("worker")
    w.add_argument("meeting")
    w.add_argument("--chunk", type=float, default=STREAM_CHUNK_S)
    v = sub.add_parser("verify-stream")
    v.add_argument("meeting")
    v.add_argument("--seconds", type=float, default=0.0, help="only the first N seconds (default: whole file)")
    sub.add_parser("probe-generate")
    a = ap.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if a.cmd in ("run", "all"):
        cmd_run([m for m in a.meetings.split(",") if m], a.n, a.force, a.chunk)
        if a.cmd == "all":
            cmd_evaluate()
    elif a.cmd == "evaluate":
        cmd_evaluate()
    elif a.cmd == "worker":
        worker(a.meeting, a.chunk)
    elif a.cmd == "verify-stream":
        cmd_verify_stream(a.meeting, a.seconds)
    elif a.cmd == "probe-generate":
        cmd_probe_generate()


if __name__ == "__main__":
    main()
