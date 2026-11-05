# App path check: finalize() with streaming diarization

Generated 2026-10-14T07:40:03+08:00 by `engine/scripts/diar_app_check.py`. Real finalize() path of the app (streaming diarization for recordings of 2 min or more) versus the validated replica of asr_der_eval.py.

- App code: git HEAD `697708dc51`; the app's Python scripts or tests have uncommitted changes (M src-tauri/resources/python/diar_stream.py;  M src-tauri/resources/python/transcribe_server.py;  M tests/python/test_diar_stream.py;  M tests/python/test_transcribe_v3_diarize.py); sha256 (first 12): diar_stream.py `2b4d25aac01f`, transcribe_v3.py `dcfdb0c0f1e6`, transcribe_server.py `bf60a7329fc2`. All 6 model runs used exactly these files.
- Method: the real `transcribe_server.finalize()` on the recording cut into 1600-sample (100 ms) capture blocks, models loaded as in the app; `emit` is captured and the timing wrappers only record (they forward every call unchanged).
- Models: STT `mlx-community/parakeet-tdt-0.6b-v3`, diarization `mlx-community/diar_streaming_sortformer_4spk-v2.1-fp16`
- AMI meeting: shortest complete meeting (or --ami-meeting) in `/Users/sayyid/Desktop/FYP/data/ami/audio`; shortest complete meetings (minutes): IS1009a 13.98, ES2004a 17.49, ES2014a 19.15, TS3003a 25.09, TS3007a 26.82
- Model workers ran with `/opt/homebrew/opt/python@3.11/bin/python3.11` (the app's python is `/opt/homebrew/bin/python3.11`); metrics ran with `/Users/sayyid/Desktop/FYP/engine/.venv-asr/bin/python` (jiwer and pyannote.metrics are only in that venv).
- Threshold of the app: recordings of at least 10 s stream (5 s chunks), shorter ones use the library's one-shot call; speaker threshold 0.5.

## Summary

- finalize() of the app ran on 5 recordings; diarization mode: stream: ami_IS1009a, ami_IS1009a_cache0.5, demo_1, demo_2, demo_3.
- Demo meetings (script reference): WER 7.0 %, DER 28.3 % (miss 0.1, FA 0.6, conf 27.6).
- ami_IS1009a: DER 24.3 % (replica 24.3 %), WER 23.4 % (replica 23.4 %); probabilities, segments, STT tokens and turns identical to the replica.
- ami_IS1009a_cache0.5: DER 24.3 % (replica 24.3 %), WER 23.4 % (replica 23.4 %); probabilities, segments, STT tokens and turns identical to the replica.
- Pooled DER %, one-shot -> streaming, AMI clips: 10 s: 35.6 -> 33.7 (stream better in 9 of 15 clips); 20 s: 38.5 -> 33.1 (stream better in 12 of 15 clips); 30 s: 38.1 -> 33.2 (stream better in 12 of 15 clips); 60 s: 42.9 -> 31.7 (stream better in 12 of 15 clips); 90 s: 38.3 -> 31.3 (stream better in 11 of 15 clips); 120 s: 37.2 -> 31.1 (stream better in 11 of 15 clips). Threshold rule gives STREAM_MIN_SECONDS = 10 s; the app uses 10 s.
- Input level (supplementary probe `app_path_level_probe.md`; 45 AMI clips of 30/60/120 s, streaming path): DER 31.5 % at the original level, 31.4 % peak-normalised, 32.1 % at -20 dB; one-shot minus peak-normalised streaming +7.6 points [+0.9, +14.5].
- ami_IS1009a: finalize() 40.1 s for 838.8 s of audio (RTF 0.048); process peak footprint 7.47 GB.

## 1. Accuracy of the app's final output

WER: final transcript against the reference, `asr_der_eval.norm_tokens` on both sides. DER: pyannote.metrics, collar 0.25 s, optimal speaker mapping, UEM = whole recording; DER = the diarization segments the app works on, 'DER % of words' = the speaker the transcript gives to every word (runs closer than 0.3 s joined; the replica's 'app_words').

| run | audio s | diarization | speakers hyp/ref | WER % | S/D/I | ref words | DER % | miss % | FA % | conf % | DER % skip overlap | DER % of words |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| demo_1 | 162.0 | stream | 2/3 | 6.9 | 20/5/4 | 422 | 28.6 | 0.1 | 0.5 | 28.1 | 28.6 | 36.6 |
| demo_2 | 127.6 | stream | 3/3 | 5.7 | 11/3/5 | 333 | 21.8 | 0.3 | 0.9 | 20.6 | 21.8 | 29.7 |
| demo_3 | 103.6 | stream | 3/3 | 8.9 | 15/4/5 | 270 | 35.8 | 0.1 | 0.3 | 35.5 | 35.8 | 44.5 |
| ami_IS1009a | 838.8 | stream | 4/4 | 23.4 | 87/338/47 | 2015 | 24.3 | 20.7 | 0.9 | 2.7 | 20.8 | 42.6 |
| ami_IS1009a_cache0.5 | 838.8 | stream | 4/4 | 23.4 | 87/338/47 | 2015 | 24.3 | 20.7 | 0.9 | 2.7 | 20.8 | 42.6 |

Demo meetings pooled: WER 7.0 % (S/D/I 46/12/14, 1025 ref words), DER 28.3 % (miss 0.1, FA 0.6, conf 27.6).

## 2. AMI meeting: app path versus the replica of asr_der_eval.py

The replica ran the same models with the same procedure outside the app (Parakeet with 120 s chunks, bounded streaming Sortformer). Probabilities, segments and turns of the replica are rebuilt from its stored raw outputs and compared with what the app's finalize() produced.

| app run | meeting | app DER % | replica DER % | app DER % of words | replica DER % of words | app WER % | replica WER % | probabilities identical | frames differing | segments identical | STT tokens identical | turns identical |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ami_IS1009a | IS1009a | 24.3 | 24.3 | 42.6 | 42.6 | 23.4 | 23.4 | yes | 0 | yes | yes | yes |
| ami_IS1009a_cache0.5 | IS1009a | 24.3 | 24.3 | 42.6 | 42.6 | 23.4 | 23.4 | yes | 0 | yes | yes | yes |

Replica numbers stored in results.json for IS1009a: DER 24.3 % (miss 20.7, FA 0.9, conf 2.7), WER 23.4 % (S/D/I 87/338/47); recomputed here from the raw outputs: identical.

## 3. One-shot versus streaming diarization on the same audio

Forced modes (`diarize_with_info(mode=...)` of the app) on identical audio, warm, diarization model only. Clips are cut from AMI meetings (IS1009a at [60, 330, 600] s, ES2004a at [100, 450, 800] s, ES2014a at [100, 450, 800] s, TS3003a at [100, 600, 1100] s, TS3007a at [100, 600, 1100] s), up to 15 per length; each clip is a recording of its own, scored against the cropped AMI reference (DER, collar 0.25 s, overlap scored). The clips of one start are nested (the 30 s clip is the beginning of the 60 s one), so the lengths are not independent samples. The one-shot call cannot take 120 s or more (it needs 1502 positions and has 1500 at 120 s): for the demos of 120 s and more its numbers show the old behaviour. Evidence for the one-shot / streaming threshold `STREAM_MIN_SECONDS`.

| demo | audio s | mode | DER % | miss % | FA % | conf % | seconds | MLX peak GB |
|---|---|---|---|---|---|---|---|---|
| meeting_1 | 162.0 | stream | 28.6 | 0.1 | 0.5 | 28.1 | 6.05 | 0.73 |
| meeting_1 | 162.0 | oneshot | 32.1 | 5.1 | 0.0 | 27.1 | 1.86 | 1.49 |
| meeting_2 | 127.6 | stream | 21.8 | 0.3 | 0.9 | 20.6 | 5.27 | 0.72 |
| meeting_2 | 127.6 | oneshot | 35.5 | 5.4 | 0.0 | 30.1 | 1.02 | 1.13 |
| meeting_3 | 103.6 | stream | 35.8 | 0.1 | 0.3 | 35.5 | 3.90 | 0.71 |
| meeting_3 | 103.6 | oneshot | 31.0 | 4.2 | 0.7 | 26.1 | 0.90 | 1.04 |

| clip s | clips | DER % one-shot | DER % stream | DER points one-shot minus stream [95 % CI] | miss % (1s / st) | FA % (1s / st) | conf % (1s / st) | mean s (1s / st) | RTF (1s / st) | max MLX GB (1s / st) | clips: stream better / one-shot better / equal |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 | 15 | 35.6 | 33.7 | 1.9 [-7.5, 12.0] | 25.3 / 28.7 | 5.2 / 3.4 | 5.1 / 1.6 | 0.07 / 0.23 | 0.007 / 0.023 | 0.33 / 0.43 | 9 / 6 / 0 |
| 20 | 15 | 38.5 | 33.1 | 5.4 [-2.2, 14.9] | 28.2 / 28.7 | 4.6 / 1.8 | 5.7 / 2.6 | 0.10 / 0.47 | 0.005 / 0.024 | 0.43 / 0.52 | 12 / 3 / 0 |
| 30 | 15 | 38.1 | 33.2 | 4.9 [-2.0, 12.8] | 28.3 / 30.1 | 3.8 / 1.2 | 6.0 / 1.9 | 0.14 / 0.81 | 0.005 / 0.027 | 0.54 / 0.63 | 12 / 3 / 0 |
| 60 | 15 | 42.9 | 31.7 | 11.2 [3.3, 20.5] | 29.7 / 28.4 | 2.6 / 0.6 | 10.6 / 2.7 | 0.30 / 1.84 | 0.005 / 0.031 | 0.97 / 0.71 | 12 / 3 / 0 |
| 90 | 15 | 38.3 | 31.3 | 7.0 [1.4, 13.1] | 27.4 / 29.2 | 1.5 / 0.4 | 9.5 / 1.7 | 0.58 / 2.91 | 0.006 / 0.032 | 1.06 / 0.71 | 11 / 4 / 0 |
| 120 | 15 | 37.2 | 31.1 | 6.2 [-1.1, 12.9] | 25.5 / 29.2 | 0.7 / 0.3 | 11.0 / 1.5 | 0.77 / 3.94 | 0.006 / 0.033 | 1.22 / 0.72 | 11 / 4 / 0 |

The interval resamples whole clips (2000 resamples, seed 0); positive means streaming has the lower DER. Max MLX GB is the process peak of the diarization-only worker (weights included).

Threshold rule: STREAM_MIN_SECONDS = the smallest tested clip length L such that, for L and for every longer tested length, the pooled DER of streaming is at most that of the one-shot call and streaming's real-time factor is at most 0.05; none if the longest tested length already fails. Result: **10 s**; the app's constant is 10 s.

## 4. Speed and memory

finalize() wall clock = STT + diarization + alignment, measured after a warm-up on a 20 s excerpt; the cold first calls are listed separately (in the app the first diarization call happens at finalize() and is cold). MLX peak: `mx.get_peak_memory()`, reset before finalize() and again before the diarization call (both models' weights are resident). Process: `/usr/bin/time -l` of the whole worker (loading, warm-up, finalize).

| run | audio s | finalize s | STT s | diarize s | align s | RTF finalize | RTF STT | RTF diarize | load s | cold s (STT / stream / one-shot) | MLX peak STT GB | MLX peak diar GB | max RSS GB | peak footprint GB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| demo_1 | 162.0 | 27.8 | 19.6 | 8.2 | 0.02 | 0.172 | 0.121 | 0.050 | 9.1 | 0.7 / 1.0 / 0.3 | 4.53 | 3.28 | 0.86 | 8.17 |
| demo_2 | 127.6 | 12.9 | 5.1 | 7.8 | 0.03 | 0.101 | 0.040 | 0.061 | 6.0 | 0.8 / 1.0 / 0.2 | 4.53 | 3.27 | 2.60 | 7.17 |
| demo_3 | 103.6 | 21.4 | 16.1 | 5.2 | 0.04 | 0.207 | 0.156 | 0.051 | 6.1 | 0.6 / 1.1 / 0.3 | 4.33 | 3.28 | 2.47 | 8.64 |
| ami_IS1009a | 838.8 | 40.1 | 17.2 | 22.8 | 0.18 | 0.048 | 0.020 | 0.027 | 18.7 | 0.3 / 0.3 / 0.1 | 4.60 | 3.88 | 3.36 | 7.47 |
| ami_IS1009a_cache0.5 | 838.8 | 51.2 | 18.2 | 32.8 | 0.14 | 0.061 | 0.022 | 0.039 | 8.6 | 0.7 / 0.4 / 0.1 | 4.60 | 3.88 | 3.02 | 5.64 |

Replica for IS1009a (cache limit 0.5 GB, same models): STT 23.7 s, diarization 38.4 s, RTF STT+diar 0.074, MLX peak STT 4.60 / diarization 3.88 GB, peak footprint 5.56 GB.

## 5. Caveats

- The demo recordings are the three scripted demo meetings, not AMI; their reference is the script (`ref.txt`) and the RTTM next to the audio, so WER measures the transcript against the script text.
- The AMI audio is the headset mix (near-field); the app records far-field microphone audio.
- DER of the AMI meeting counts overlapped speech (AMI is spontaneous); the 'skip overlap' column removes it.
- One run per recording: no repeats. The replica's bit-exact reproducibility was shown separately (asr/README.md).
- Timing depends on whatever else uses the GPU at that moment.
- Streaming still computes the log-mel features of the whole recording at once, so MLX memory grows linearly (about 0.05 GB per minute) beyond the model weights.
