# Memoria pipeline on AMI (headset mix): WER and DER

Pipeline: Parakeet-TDT-0.6b-v3 (STT) + Sortformer-4spk-v2.1 streaming (diarization), MLX, Apple M5.
6 meetings, 132.9 min, teams: ES2004, ES2014, IS1009, TS3003, TS3007. Generated 2026-10-13T23:34:39+08:00.

## Main table

WER: lower-cased, punctuation stripped, nothing expanded, all four speakers merged in word-start-time order, `jiwer`; S/D/I = counts of
substitutions/deletions/insertions (percentages are relative to the reference words). DER: `pyannote.metrics` `DiarizationErrorRate`,
collar 0.25 (pyannote semantics: +-0.125 s), overlap scored, reference = AMI manual segments (merged at 0.3 s); Miss/FA/Conf are % of
the scored reference speaker time (overlap counted once per speaker); "skip overlap" = same but ignoring all overlapped reference speech. RTF = (STT + diarization seconds) / audio seconds.

| Meeting | Team | Min | WER % | S | D | I | DER % | Miss % | FA % | Conf % | DER % (skip overlap) | RTF |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| IS1009a | IS1009 | 14.0 | 23.4 | 87 | 338 | 47 | 24.3 | 20.7 | 0.9 | 2.7 | 20.8 | 0.0741 |
| ES2004a | ES2004 | 17.5 | 20.8 | 95 | 438 | 17 | 32.1 | 31.3 | 0.0 | 0.8 | 25.1 | 0.1101 |
| ES2014a | ES2014 | 19.2 | 17.9 | 84 | 213 | 101 | 38.5 | 36.0 | 0.9 | 1.6 | 35.5 | 0.1190 |
| TS3003a | TS3003 | 25.1 | 21.7 | 144 | 380 | 23 | 38.3 | 37.5 | 0.3 | 0.5 | 35.4 | 0.0847 |
| TS3007a | TS3007 | 26.8 | 20.6 | 175 | 448 | 74 | 27.9 | 26.7 | 0.1 | 1.1 | 23.4 | 0.0879 |
| IS1009c | IS1009 | 30.3 | 17.3 | 194 | 568 | 26 | 15.8 | 14.2 | 0.6 | 1.0 | 13.9 | 0.0986 |
| **Pooled** | 5 teams | 132.9 | **19.9** | 779 | 2385 | 288 | **28.4** | 26.8 | 0.4 | 1.2 | 24.8 | 0.0957 |
| Mean of meetings | | 22.1 | 20.3 | | | | 29.5 | 27.7 | 0.5 | 1.3 | 25.7 | 0.0957 |

## Speed and memory

| Meeting | Audio s | STT s | Diar s | STT+Diar s | Process wall s (incl. model load + warm-up) | RTF STT | RTF Diar | RTF total | Peak mem footprint GB | MLX peak GB (STT / Diar) | MLX cache limit |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| IS1009a | 839 | 23.7 | 38.4 | 62.1 | 80 | 0.0282 | 0.0458 | 0.0741 | 5.56 | 4.60 / 3.88 | 0.5 GB |
| ES2004a | 1049 | 40.9 | 74.7 | 115.6 | 136 | 0.0389 | 0.0712 | 0.1101 | 5.69 | 4.62 / 4.06 | 0.5 GB |
| ES2014a | 1149 | 52.6 | 84.2 | 136.7 | 165 | 0.0457 | 0.0733 | 0.1190 | 5.73 | 4.63 / 4.15 | 0.5 GB |
| TS3003a | 1506 | 44.3 | 83.2 | 127.5 | 146 | 0.0294 | 0.0552 | 0.0847 | 5.85 | 4.66 / 4.47 | 0.5 GB |
| TS3007a | 1609 | 53.9 | 87.6 | 141.4 | 154 | 0.0335 | 0.0544 | 0.0879 | 5.85 | 4.67 / 4.56 | 0.5 GB |
| IS1009c | 1821 | 60.0 | 119.5 | 179.5 | 196 | 0.0330 | 0.0656 | 0.0986 | 5.92 | 4.69 / 4.59 | 0.5 GB |
| **Pooled** | 7973 | 275.3 | 487.6 | 762.9 | 876 | 0.0345 | 0.0612 | 0.0957 | max 5.92 | | |

## Sensitivity analyses (pooled)

| WER variant (pooled) | WER % | S | D | I |
|---|---:|---:|---:|---:|
| primary (ref ordered by word start time, all lexical tokens) | 19.9 | 779 | 2385 | 288 |
| reference ordered utterance-by-utterance | 21.1 | 841 | 2457 | 360 |
| truncated-word fragments removed from reference | 19.2 | 726 | 2193 | 362 |
| uh/um/mm/mhm/mmm/hmm removed from both | 18.0 | 695 | 1907 | 276 |
| fragments + fillers removed | 17.2 | 645 | 1712 | 347 |

| DER variant (pooled) | DER % | Miss % | FA % | Conf % |
|---|---:|---:|---:|---:|
| **primary**: collar 0.25, overlap scored, thr 0.5, segments ref | 28.4 | 26.8 | 0.4 | 1.2 |
| collar 0.25, overlap skipped | 24.8 | 23.2 | 0.5 | 1.0 |
| collar 0.5 (= NIST +-0.25 s), overlap scored | 26.9 | 25.3 | 0.4 | 1.1 |
| collar 0.5 (= NIST +-0.25 s), overlap skipped | 24.1 | 22.6 | 0.5 | 1.0 |
| no collar, overlap scored | 31.6 | 29.7 | 0.6 | 1.3 |
| no collar, overlap skipped | 26.7 | 24.9 | 0.7 | 1.1 |
| threshold 0.4, collar 0.25, overlap scored | 27.2 | 25.0 | 0.8 | 1.4 |
| threshold 0.3, collar 0.25, overlap scored | 26.6 | 23.5 | 1.7 | 1.5 |
| ref: no merging of same-speaker segments (gap 0), collar 0.25 | 28.4 | 26.8 | 0.4 | 1.2 |
| ref: incl. vocalsound-only segments, collar 0.25 | 30.9 | 29.4 | 0.4 | 1.1 |
| ref: word-timing speech (merge 0.3 s), collar 0.25 | 25.0 | 23.1 | 0.7 | 1.2 |
| ref: word-timing speech (merge 0.3 s), collar 0.5, overlap skipped | 23.1 | 21.4 | 0.6 | 1.0 |
| hyp = app's final per-word speaker labels (aligned_words; only transcribed words count as speech), collar 0.25 | 34.9 | 23.3 | 9.9 | 1.7 |
| hyp = app's final per-word speaker labels, collar 0.25, overlap skipped | 28.4 | 14.6 | 11.9 | 1.8 |

See README.md for definitions and caveats.
