# App path check: finalize() with streaming diarization

Generated 2026-10-14T03:37:19+08:00 by `engine/scripts/diar_app_check.py`. Real finalize() path of the app (streaming diarization for recordings of 2 min or more) versus the validated replica of asr_der_eval.py.

- App code: git HEAD `2ffe32ba80` plus uncommitted changes (5 paths); sha256 (first 12): diar_stream.py `7522e6bfa04e`, transcribe_v3.py `dcfdb0c0f1e6`, transcribe_server.py `acc8258f1ea3`
- Method: the real `transcribe_server.finalize()` on the recording cut into 1600-sample (100 ms) capture blocks, models loaded as in the app; `emit` is captured and the timing wrappers only record (they forward every call unchanged).
- Models: STT `mlx-community/parakeet-tdt-0.6b-v3`, diarization `mlx-community/diar_streaming_sortformer_4spk-v2.1-fp16`
- AMI meeting: shortest complete meeting (or --ami-meeting) in `/Users/sayyid/Desktop/FYP/data/ami/audio`; shortest complete meetings (minutes): IS1009a 13.98, ES2004a 17.49, ES2014a 19.15, TS3003a 25.09, TS3007a 26.82
- Model workers ran with `/opt/homebrew/opt/python@3.11/bin/python3.11` (the app's python is `/opt/homebrew/bin/python3.11`); metrics ran with `/Users/sayyid/Desktop/FYP/engine/.venv-asr/bin/python` (jiwer and pyannote.metrics are only in that venv).
- Threshold of the app: recordings of at least 120 s stream (5 s chunks), shorter ones use the library's one-shot call; speaker threshold 0.5.

## Summary

- finalize() of the app ran on 5 recordings; diarization mode: oneshot: demo_3; stream: ami_IS1009a, ami_IS1009a_cache0.5, demo_1, demo_2.
- Demo meetings (script reference): WER 7.0 %, DER 27.1 % (miss 1.2, FA 0.7, conf 25.2).
- ami_IS1009a: DER 24.3 % (replica 24.3 %), WER 23.4 % (replica 23.4 %); probabilities, segments, STT tokens and turns identical to the replica.
- ami_IS1009a_cache0.5: DER 24.3 % (replica 24.3 %), WER 23.4 % (replica 23.4 %); probabilities, segments, STT tokens and turns identical to the replica.
- ami_IS1009a: finalize() 39.3 s for 838.8 s of audio (RTF 0.047); process peak footprint 7.47 GB.

## 1. Accuracy of the app's final output

WER: final transcript against the reference, `asr_der_eval.norm_tokens` on both sides. DER: pyannote.metrics, collar 0.25 s, optimal speaker mapping, UEM = whole recording; DER = the diarization segments the app works on, 'DER % of words' = the speaker the transcript gives to every word (runs closer than 0.3 s joined; the replica's 'app_words').

| run | audio s | diarization | speakers hyp/ref | WER % | S/D/I | ref words | DER % | miss % | FA % | conf % | DER % skip overlap | DER % of words |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| demo_1 | 162.0 | stream | 2/3 | 6.9 | 20/5/4 | 422 | 28.6 | 0.1 | 0.5 | 28.1 | 28.6 | 36.6 |
| demo_2 | 127.6 | stream | 3/3 | 5.7 | 11/3/5 | 333 | 21.8 | 0.3 | 0.9 | 20.6 | 21.8 | 29.7 |
| demo_3 | 103.6 | oneshot | 2/3 | 8.9 | 15/4/5 | 270 | 31.0 | 4.2 | 0.7 | 26.1 | 31.0 | 35.1 |
| ami_IS1009a | 838.8 | stream | 4/4 | 23.4 | 87/338/47 | 2015 | 24.3 | 20.7 | 0.9 | 2.7 | 20.8 | 42.6 |
| ami_IS1009a_cache0.5 | 838.8 | stream | 4/4 | 23.4 | 87/338/47 | 2015 | 24.3 | 20.7 | 0.9 | 2.7 | 20.8 | 42.6 |

Demo meetings pooled: WER 7.0 % (S/D/I 46/12/14, 1025 ref words), DER 27.1 % (miss 1.2, FA 0.7, conf 25.2).

## 2. AMI meeting: app path versus the replica of asr_der_eval.py

The replica ran the same models with the same procedure outside the app (Parakeet with 120 s chunks, bounded streaming Sortformer). Probabilities, segments and turns of the replica are rebuilt from its stored raw outputs and compared with what the app's finalize() produced.

| app run | meeting | app DER % | replica DER % | app DER % of words | replica DER % of words | app WER % | replica WER % | probabilities identical | frames differing | segments identical | STT tokens identical | turns identical |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ami_IS1009a | IS1009a | 24.3 | 24.3 | 42.6 | 42.6 | 23.4 | 23.4 | yes | 0 | yes | yes | yes |
| ami_IS1009a_cache0.5 | IS1009a | 24.3 | 24.3 | 42.6 | 42.6 | 23.4 | 23.4 | yes | 0 | yes | yes | yes |

Replica numbers stored in results.json for IS1009a: DER 24.3 % (miss 20.7, FA 0.9, conf 2.7), WER 23.4 % (S/D/I 87/338/47); recomputed here from the raw outputs: identical.

## 3. One-shot versus streaming diarization on the same audio

Forced modes on identical audio (warm, after a warm-up). Clips are cut from AMI meetings (IS1009a, ES2004a; starts [60, 100, 330, 450, 600, 800] s) and scored against the cropped AMI reference, DER at collar 0.25 s with overlap scored. A recording of 120 s or more does not fit the one-shot call's 1500 positions: that is the old behaviour. Evidence for the one-shot / streaming threshold (`STREAM_MIN_SECONDS`); small samples, indicative only.

| demo | audio s | mode | DER % | miss % | FA % | conf % | seconds | MLX peak GB |
|---|---|---|---|---|---|---|---|---|
| meeting_1 | 162.0 | stream | 28.6 | 0.1 | 0.5 | 28.1 | 4.21 | 0.73 |
| meeting_1 | 162.0 | oneshot | 32.1 | 5.1 | 0.0 | 27.1 | 0.79 | 1.49 |
| meeting_2 | 127.6 | stream | 21.8 | 0.3 | 0.9 | 20.6 | 3.00 | 0.72 |
| meeting_2 | 127.6 | oneshot | 35.5 | 5.4 | 0.0 | 30.1 | 0.49 | 1.13 |
| meeting_3 | 103.6 | stream | 35.8 | 0.1 | 0.3 | 35.5 | 2.50 | 0.71 |
| meeting_3 | 103.6 | oneshot | 31.0 | 4.2 | 0.7 | 26.1 | 0.41 | 1.04 |

| clip s | clips | DER % one-shot | DER % stream | miss % (1s / st) | FA % (1s / st) | conf % (1s / st) | mean s (1s / st) | RTF (1s / st) | max MLX GB (1s / st) | clips: stream better / one-shot better / equal |
|---|---|---|---|---|---|---|---|---|---|---|
| 30 | 6 | 36.3 | 30.8 | 26.9 / 28.2 | 0.0 / 0.0 | 9.3 / 2.6 | 0.10 / 0.61 | 0.003 / 0.020 | 0.54 / 0.63 | 5 / 1 / 0 |
| 60 | 6 | 39.7 | 31.4 | 26.1 / 26.4 | 0.9 / 0.1 | 12.6 / 5.0 | 0.17 / 1.63 | 0.003 / 0.027 | 0.96 / 0.71 | 6 / 0 / 0 |
| 90 | 6 | 35.4 | 29.1 | 24.7 / 25.6 | 0.6 / 0.1 | 10.0 / 3.4 | 0.39 / 1.79 | 0.004 / 0.020 | 1.06 / 0.71 | 5 / 1 / 0 |
| 120 | 6 | 36.4 | 27.7 | 24.1 / 24.5 | 0.6 / 0.1 | 11.7 / 3.1 | 0.51 / 3.06 | 0.004 / 0.026 | 1.22 / 0.72 | 5 / 1 / 0 |

## 4. Speed and memory

finalize() wall clock = STT + diarization + alignment, measured after a warm-up on a 20 s excerpt; the cold first calls are listed separately (in the app the first diarization call happens at finalize() and is cold). MLX peak: `mx.get_peak_memory()`, reset before finalize() and again before the diarization call (both models' weights are resident). Process: `/usr/bin/time -l` of the whole worker (loading, warm-up, finalize).

| run | audio s | finalize s | STT s | diarize s | align s | RTF finalize | RTF STT | RTF diarize | load s | cold s (STT / stream / one-shot) | MLX peak STT GB | MLX peak diar GB | max RSS GB | peak footprint GB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| demo_1 | 162.0 | 9.1 | 4.8 | 4.3 | 0.02 | 0.056 | 0.030 | 0.026 | 5.8 | 1.9 / 0.3 / 0.1 | 4.53 | 3.28 | 2.57 | 8.18 |
| demo_2 | 127.6 | 7.3 | 4.0 | 3.3 | 0.01 | 0.057 | 0.031 | 0.026 | 5.4 | 0.2 / 0.2 / 0.0 | 4.53 | 3.27 | 3.28 | 7.18 |
| demo_3 | 103.6 | 3.1 | 2.5 | 0.6 | 0.01 | 0.030 | 0.024 | 0.006 | 5.9 | 0.2 / 0.2 / 0.1 | 4.33 | 3.59 | 3.28 | 8.06 |
| ami_IS1009a | 838.8 | 39.3 | 17.1 | 22.0 | 0.16 | 0.047 | 0.020 | 0.026 | 5.6 | 0.2 / 0.2 / 0.1 | 4.60 | 3.88 | 3.37 | 7.47 |
| ami_IS1009a_cache0.5 | 838.8 | 38.0 | 16.1 | 21.8 | 0.10 | 0.045 | 0.019 | 0.026 | 6.2 | 0.2 / 0.2 / 0.1 | 4.60 | 3.88 | 3.49 | 5.63 |

Replica for IS1009a (cache limit 0.5 GB, same models): STT 23.7 s, diarization 38.4 s, RTF STT+diar 0.074, MLX peak STT 4.60 / diarization 3.88 GB, peak footprint 5.56 GB.

## 5. Caveats

- The demo recordings are the three scripted demo meetings, not AMI; their reference is the script (`ref.txt`) and the RTTM next to the audio, so WER measures the transcript against the script text.
- The AMI audio is the headset mix (near-field); the app records far-field microphone audio.
- DER of the AMI meeting counts overlapped speech (AMI is spontaneous); the 'skip overlap' column removes it.
- One run per recording: no repeats. The replica's bit-exact reproducibility was shown separately (asr/README.md).
- Timing depends on whatever else uses the GPU at that moment.
- Streaming still computes the log-mel features of the whole recording at once, so MLX memory grows linearly (about 0.05 GB per minute) beyond the model weights.
