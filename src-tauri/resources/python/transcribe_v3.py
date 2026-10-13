#!/usr/bin/env /opt/homebrew/bin/python3.11
"""Diarized transcription v3: pure-MLX speaker ID + overlap-aware word alignment.

Upgrades over transcribe_v2.py:
  1. Speaker identification now uses the pure-MLX WeSpeaker ResNet34 embedding
     model (mlx-community/wespeaker-voxceleb-resnet34-LM) instead of Resemblyzer.
     This drops the torch dependency and runs natively on MLX. NOTE: the model
     card's librosa recipe (power_to_db) does NOT separate speakers — the weights
     expect Kaldi-style log-mel fbank with cepstral mean normalization (CMN),
     which is what embed() below computes.
  2. Overlap-aware word->speaker assignment: a word's speaker is the one with the
     most time-overlap across its window (handles overlapping speech), not just
     whichever segment happens to cover the midpoint.

Word alignment is still snapped to sentence boundaries (dominant speaker per
sentence, with a significant-run exception for genuine interruptions).

Usage:
    python3 transcribe_v3.py data/clip.wav --enroll enroll
    python3 transcribe_v3.py data/clip.wav            # anonymous Speaker N
"""

import argparse
import glob
import os
import sys
import time

import numpy as np
import mlx.core as mx
from scipy.io import wavfile

STT = "mlx-community/parakeet-tdt-0.6b-v3"
DIAR = "mlx-community/diar_streaming_sortformer_4spk-v2.1-fp16"
SPK = "mlx-community/wespeaker-voxceleb-resnet34-LM"
SAMPLE_RATE = 16000
ID_FLOOR = 0.50          # below this best-match similarity -> keep anonymous label


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


def make_embedder():
    """Load the pure-MLX WeSpeaker ResNet34 model and return embed(samples)->vec.

    Features must be Kaldi-style: 80-bin log-mel fbank with per-utterance cepstral
    mean normalization. The returned vectors are L2-normalized so cosine == dot.
    """
    from huggingface_hub import hf_hub_download
    import librosa

    loader = hf_hub_download(SPK, "resnet_embedding.py")
    weights = hf_hub_download(SPK, "weights.npz")
    sys.path.insert(0, os.path.dirname(loader))
    from resnet_embedding import load_resnet34_embedding
    model = load_resnet34_embedding(weights)

    def embed(samples):
        mel = librosa.feature.melspectrogram(
            y=samples, sr=SAMPLE_RATE, n_fft=512, hop_length=160,
            win_length=400, n_mels=80, fmin=20, fmax=7600)
        logm = np.log(np.maximum(mel, 1e-10)).T          # (time, 80)
        logm = logm - logm.mean(axis=0, keepdims=True)   # CMN over time
        e = model(mx.array(logm[np.newaxis].astype(np.float32)))[0]
        e = e / mx.linalg.norm(e)
        return np.array(e)

    return embed


def identify(audio, spk_segments, enroll_dir):
    """Map each diarized cluster id -> enrolled name via WeSpeaker embeddings."""
    embed = make_embedder()

    enrolled = {}
    for path in sorted(glob.glob(os.path.join(enroll_dir, "*.wav"))):
        name = os.path.splitext(os.path.basename(path))[0]
        enrolled[name] = embed(load_wav(path))
    if not enrolled:
        return {}, []

    clusters = sorted({spk for _, _, spk in spk_segments})
    mapping, report = {}, []
    for spk in clusters:
        parts = [audio[int(d0 * SAMPLE_RATE):int(d1 * SAMPLE_RATE)]
                 for d0, d1, s in spk_segments if s == spk]
        cluster_audio = np.concatenate(parts)[: SAMPLE_RATE * 40]  # cap at 40s
        emb = embed(cluster_audio)
        sims = {name: float(np.dot(emb, ref)) for name, ref in enrolled.items()}
        best = max(sims, key=sims.get)
        mapping[spk] = best if sims[best] >= ID_FLOOR else f"Speaker {spk}"
        report.append((spk, mapping[spk], sims))
    return mapping, report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("wav")
    ap.add_argument("--enroll", default=None, help="dir of <name>.wav reference clips")
    ap.add_argument("--chunk", type=float, default=120.0)
    args = ap.parse_args()

    audio = load_wav(args.wav)
    from mlx_audio.stt.utils import load as load_stt
    from mlx_audio.vad.utils import load_model as load_vad

    print("Transcribing (Parakeet)...")
    stt = load_stt(STT)
    t = time.time()
    result = stt.generate(mx.array(audio), chunk_duration=args.chunk)
    print(f"  {sum(len(s.tokens) for s in result.sentences)} tokens in {time.time() - t:.1f}s")

    print("Diarizing (Sortformer)...")
    diar = load_vad(DIAR)
    t = time.time()
    dia = diar.generate(mx.array(audio), threshold=0.5)
    spk_segments = [(d.start, d.end, d.speaker) for d in dia.segments]
    print(f"  {len(spk_segments)} segments, speakers={sorted({s for *_, s in spk_segments})} "
          f"in {time.time() - t:.1f}s")

    words, labels = aligned_words(result, spk_segments)

    name_map = {}
    if args.enroll:
        print(f"Identifying speakers (WeSpeaker, enroll: {args.enroll})...")
        name_map, report = identify(audio, spk_segments, args.enroll)
        for spk, name, sims in report:
            sim_str = ", ".join(f"{n}={v:.3f}" for n, v in sorted(sims.items(), key=lambda x: -x[1]))
            print(f"  cluster {spk} -> {name}   [{sim_str}]")

    turns = build_turns(words, labels)
    # re-merge adjacent turns that resolve to the same name
    named = [(s, e, name_map.get(spk, f"Speaker {spk}"), txt) for s, e, spk, txt in turns]
    merged = []
    for s, e, who, txt in named:
        if merged and merged[-1][2] == who:
            merged[-1] = (merged[-1][0], e, who, merged[-1][3] + " " + txt)
        else:
            merged.append((s, e, who, txt))

    print("\n" + "=" * 60 + "\n")
    out_path = args.wav.rsplit(".", 1)[0] + "_v3.txt"
    with open(out_path, "w") as f:
        for s, e, who, txt in merged:
            line = f"[{s:.1f}s - {e:.1f}s] {who}: {txt}"
            print(line + "\n")
            f.write(line + "\n\n")
    print(f"saved {out_path}")


if __name__ == "__main__":
    main()
