# Input level versus the app's streaming diarization

Supplementary probe to `app_path_check.md` (script `engine/scripts/diar_level_probe.py`). The library's one-shot call peak-normalises its input (`x / (max|x| + 1e-3)`); the streaming path of the app does not. The five AMI meetings differ in RMS level by 27 dB (section 1). This probe changes only the level of identical clips.

- Clips: lengths 30, 60, 120 s at 15 starts of 5 meetings (45 clips, each a recording of its own, as in `compare`); diarization by the app's streaming path (`transcribe_v3.diarize_with_info(mode="stream")`) at `original` level, `peaknorm` (the clip divided by its own peak + 1e-3) and `minus20db` (x 0.1). The one-shot column is the forced one-shot result of `compare` on the same clips (level-independent by construction).
- DER with pyannote.metrics, collar 0.25 s, overlap scored; pooled = total errors / total reference speech. Run 2026-10-14T05:50:59+08:00; models: `mlx-community/diar_streaming_sortformer_4spk-v2.1-fp16`.
- Check: the `original` streaming segments are identical to those of `compare` for every clip: **True**.

## 1. DER by meeting (pooled over 9 clips of 30 / 60 / 120 s)

| meeting | peak | RMS dBFS | peak-norm gain dB | one-shot DER % | stream DER % | stream, peak-normalised DER % | stream, -20 dB DER % |
|---|---|---|---|---|---|---|---|
| IS1009a | 1.00 | -21.5 | +1.4 | 36.2 | 26.5 | 26.5 | 27.1 |
| ES2004a | 0.80 | -36.1 | +9.2 | 38.5 | 31.9 | 31.2 | 33.0 |
| ES2014a | 0.80 | -35.2 | +10.4 | 44.4 | 30.5 | 30.4 | 31.8 |
| TS3003a | 0.24 | -46.7 | +21.4 | 28.1 | 40.7 | 39.6 | 41.1 |
| TS3007a | 0.19 | -48.8 | +25.9 | 49.8 | 27.5 | 29.0 | 26.6 |
| **all** | | | | **38.9** | **31.5** | **31.4** | **32.1** |

Peak and RMS: the whole meeting file (RMS over all samples, silence included). Peak-norm gain: mean over the clips of the boost the peak normalisation applies (clip peak before / after).

## 2. Error components, all clips pooled

| variant | DER % | missed % | false alarm % | confusion % |
|---|---|---|---|---|
| one-shot | 38.9 | 27.1 | 1.7 | 10.2 |
| stream | 31.5 | 29.1 | 0.5 | 1.9 |
| stream, peak-normalised | 31.4 | 28.6 | 0.6 | 2.1 |
| stream, -20 dB | 32.1 | 30.0 | 0.1 | 2.0 |

By clip length (DER %):

| clip s | one-shot | stream | stream, peak-normalised | stream, -20 dB |
|---|---|---|---|---|
| 30 | 38.1 | 33.2 | 31.5 | 30.9 |
| 60 | 42.9 | 31.7 | 31.6 | 32.7 |
| 120 | 37.2 | 31.1 | 31.2 | 32.0 |

## 3. Paired differences over the 15 starts

Difference = DER of A minus DER of B in points (positive: B is better), 95 % percentile bootstrap resampling starts; the last two columns count starts where B / A has the lower DER.

| A | B | A - B pts [95 % CI] | starts B better / A better |
|---|---|---|---|
| stream | stream, peak-normalised | +0.2 [-0.6, +0.9] | 8 / 6 |
| stream | stream, -20 dB | -0.5 [-1.3, +0.3] | 6 / 9 |
| one-shot | stream | +7.4 [+0.2, +14.8] | 12 / 3 |
| one-shot | stream, peak-normalised | +7.6 [+0.9, +14.5] | 12 / 3 |

Streaming time per clip (mean, seconds): stream 1.62, stream, peak-normalised 1.71, stream, -20 dB 1.64 (the GPU was shared with another agent's build; timing only indicative).

Interpreter of the model run: `/opt/homebrew/opt/python@3.11/bin/python3.11`; libraries: python 3.11.17, mlx 0.31.2, mlx-audio 0.4.3, numpy 2.4.5.
