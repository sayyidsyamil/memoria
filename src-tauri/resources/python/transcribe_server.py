#!/usr/bin/env /opt/homebrew/bin/python3.11
"""Live transcription bridge for Memoria.

Spawned by Memoria's Rust backend. Emits newline-delimited JSON on stdout:

    {"type":"status","msg":"loading models"}
    {"type":"ready"}
    {"type":"level","rms":0.03,"voiced":true}            # ~10/s, drives mic meter
    {"type":"partial","t0":3.1,"t1":5.4,"text":"hi"}     # live, per utterance
    {"type":"final","turns":[...],"speakers":[...],       # diarized, on stop
                    "sessionId":"...","duration":12.3}
    {"type":"error","msg":"..."}

Control file (--control PATH): contents are one of "", "pause", "stop".
  - "pause" suspends capture (mic blocks discarded); "" resumes; "stop" finalizes.

Voice enrollment (opt-in, see voice_store.py): when the user has switched voice profiles on,
on finalize we compute a WeSpeaker embedding per diarized speaker and match it against the
named voiceprints in ~/.memoria/voices.json. Matches come back as `speakers[].suggested` so
the UI can pre-fill names. The embeddings of all speakers wait in a short-lived, owner-only
~/.memoria/sessions/<id>.json until the user saves (only named speakers are enrolled) or
closes the panel (nothing is kept); either way the file is deleted. With voice profiles off,
no embedding is computed and nothing is written.
"""

import argparse
import json
import sys
import time
import queue
from pathlib import Path

import numpy as np
import sounddevice as sd
import mlx.core as mx

from transcribe_v3 import STT, DIAR, aligned_words, build_turns, diarize
import voice_store

SAMPLE_RATE = 16000
BLOCK_MS = 100
BLOCK_SIZE = SAMPLE_RATE * BLOCK_MS // 1000
SILENCE_HANG_MS = 600
MIN_SPEECH_MS = 300
MAX_SEGMENT_MS = 15000
PREROLL_BLOCKS = 3

REMEMBER_VOICES = False   # set by --remember-voices (the user opted in)
MATCH_FLOOR = 0.50          # cosine >= this -> auto-suggest the enrolled name


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def read_control(control_path):
    try:
        return Path(control_path).read_text().strip()
    except FileNotFoundError:
        return ""


# --------------------------------------------------------------------------- #
# Voice matching (storage rules live in voice_store.py)
# --------------------------------------------------------------------------- #

_EMBED = None


def get_embedder():
    global _EMBED
    if _EMBED is None:
        from transcribe_v3 import make_embedder
        _EMBED = make_embedder()
    return _EMBED


def speaker_embeddings(audio, spk_segments):
    """One L2-normalized embedding per diarized speaker (cap 40s of their audio)."""
    embed = get_embedder()
    out = {}
    speakers = sorted({s for _, _, s in spk_segments})
    for spk in speakers:
        parts = [audio[int(d0 * SAMPLE_RATE):int(d1 * SAMPLE_RATE)]
                 for d0, d1, s in spk_segments if s == spk]
        if not parts:
            continue
        clip = np.concatenate(parts)[: SAMPLE_RATE * 40]
        if len(clip) < SAMPLE_RATE // 2:        # <0.5s is too little to embed
            continue
        out[f"Speaker {spk}"] = embed(clip)
    return out


# --------------------------------------------------------------------------- #
# Live capture
# --------------------------------------------------------------------------- #

def capture(args, stt):
    audio_q: "queue.Queue[np.ndarray]" = queue.Queue()

    def callback(indata, frames, time_info, status):
        if status:
            emit({"type": "status", "msg": f"audio input: {status}"})
        audio_q.put(indata[:, 0].copy())

    blocks_per_silence = SILENCE_HANG_MS // BLOCK_MS
    min_speech_blocks = MIN_SPEECH_MS // BLOCK_MS
    max_segment_blocks = MAX_SEGMENT_MS // BLOCK_MS

    captured = []
    total_samples = 0

    def transcribe_partial(blocks, start_sample):
        audio = np.concatenate(blocks).astype(np.float32)
        out = stt.generate(mx.array(audio))
        text = out.text.strip()
        if text:
            t0 = start_sample / SAMPLE_RATE
            t1 = (start_sample + len(audio)) / SAMPLE_RATE
            emit({"type": "partial", "t0": round(t0, 1), "t1": round(t1, 1), "text": text})

    device_info = sd.query_devices(args.device, "input")
    emit({"type": "status", "msg": f"opening microphone: {device_info['name']}"})

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32",
                        blocksize=BLOCK_SIZE, device=args.device, callback=callback):
        deadline = time.time() + 1.0
        levels = []
        while time.time() < deadline:
            try:
                b = audio_q.get(timeout=0.5)
            except queue.Empty:
                continue
            captured.append(b)
            total_samples += len(b)
            levels.append(float(np.sqrt(np.mean(b ** 2))))
        floor = float(np.median(levels)) if levels else 0.0
        threshold = max(floor * 4.0, 0.012)
        emit({"type": "ready"})

        preroll, segment = [], []
        seg_start_sample = 0
        in_speech = False
        silence_run = 0
        last_ctl_check = 0.0
        paused = False

        while True:
            if time.time() - last_ctl_check > 0.2:
                last_ctl_check = time.time()
                state = read_control(args.control)
                if state == "stop":
                    break
                now_paused = state == "pause"
                if now_paused != paused:
                    paused = now_paused
                    emit({"type": "status", "msg": "paused" if paused else "recording"})
                    in_speech, segment, preroll = False, [], []

            try:
                block = audio_q.get(timeout=0.2)
            except queue.Empty:
                continue

            if paused:
                continue

            captured.append(block)
            block_start = total_samples
            total_samples += len(block)
            rms = float(np.sqrt(np.mean(block ** 2)))
            voiced = rms >= threshold
            emit({"type": "level", "rms": round(rms, 4), "voiced": bool(voiced)})

            if not in_speech:
                preroll.append(block)
                if len(preroll) > PREROLL_BLOCKS:
                    preroll.pop(0)
                if voiced:
                    in_speech, silence_run = True, 0
                    segment = list(preroll)
                    seg_start_sample = block_start - (len(preroll) - 1) * BLOCK_SIZE
                    preroll = []
            else:
                segment.append(block)
                silence_run = 0 if voiced else silence_run + 1
                end_of_utt = silence_run >= blocks_per_silence
                too_long = len(segment) >= max_segment_blocks
                if end_of_utt or too_long:
                    speech = segment[:len(segment) - silence_run] if end_of_utt else segment
                    in_speech, segment = False, []
                    if len(speech) >= min_speech_blocks:
                        transcribe_partial(speech, max(0, seg_start_sample))

    return captured


def finalize(stt, diar, captured):
    duration = round(sum(len(b) for b in captured) / SAMPLE_RATE, 1)
    if not captured:
        emit({"type": "final", "turns": [], "speakers": [], "sessionId": "", "duration": 0})
        return
    audio = np.concatenate(captured).astype(np.float32)

    result = stt.generate(mx.array(audio), chunk_duration=120.0)
    spk_segments = diarize(diar, audio)   # streaming for recordings >= 2 min, see diar_stream.py

    words, labels = aligned_words(result, spk_segments)
    turns = build_turns(words, labels)

    payload = []
    for s, e, spk, txt in turns:
        payload.append({"t0": round(s, 1), "t1": round(e, 1),
                        "speaker": f"Speaker {spk}", "text": txt})

    speakers, session_id = match_and_store_speakers(audio, spk_segments)
    emit({"type": "final", "turns": payload, "speakers": speakers,
          "sessionId": session_id, "duration": duration})


def match_and_store_speakers(audio, spk_segments):
    """Embed each speaker, suggest enrolled names, persist embeddings for later enroll."""
    speaker_ids = sorted({f"Speaker {s}" for _, _, s in spk_segments})
    speakers = [{"id": sid, "suggested": None} for sid in speaker_ids]
    session_id = ""
    if not REMEMBER_VOICES:   # opt-in only: no voiceprints are computed, matched or stored
        return speakers, session_id
    try:
        emit({"type": "status", "msg": "identifying speakers"})
        voice_store.sweep_stale_sessions()
        embs = speaker_embeddings(audio, spk_segments)
        voices = voice_store.load_voices()
        for sp in speakers:
            emb = embs.get(sp["id"])
            if emb is None:
                continue
            name, score = voice_store.best_match(emb, voices)
            if name is not None and score >= MATCH_FLOOR:
                sp["suggested"] = name
        session_id = voice_store.save_session(True, embs)
    except Exception as e:  # enrollment is best-effort; never block the transcript
        emit({"type": "status", "msg": f"speaker id unavailable: {type(e).__name__}"})
    return speakers, session_id


def run_live(args):
    emit({"type": "status", "msg": "loading models"})
    from mlx_audio.stt.utils import load as load_stt
    from mlx_audio.vad.utils import load_model as load_vad
    stt = load_stt(STT)
    diar = load_vad(DIAR)

    captured = capture(args, stt)
    emit({"type": "status", "msg": "diarizing full recording"})
    finalize(stt, diar, captured)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--control", help="poll file; 'stop'/'pause' control capture")
    ap.add_argument("--device", type=int, default=None)
    ap.add_argument("--remember-voices", action="store_true", help="opt-in: compute and store voiceprints")
    args = ap.parse_args()
    global REMEMBER_VOICES
    REMEMBER_VOICES = args.remember_voices

    run_live(args)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        emit({"type": "error", "msg": f"{type(e).__name__}: {e}"})
        sys.exit(1)
