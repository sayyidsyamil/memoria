# Keluar Sekejap sustained speech test — 1 November 2026

## Source

EP29 #SembangKS | Hala TuJu AI Bubble, published 28 October 2026.
https://www.youtube.com/watch?v=bia5Cz0DHHc
Duration: 44:46 (decoded PCM 2686.016 seconds).

Audio format 251 downloaded with isolated yt-dlp 2026.10.21/Node JS runtime,
then FFmpeg converted to mono 16kHz PCM. Malay `ms` subtitle JSON3 was downloaded
from YouTube's separately listed subtitle track, not auto-translated `ms-en`.
Authorship, transcription fidelity and human verification were not confirmed.
No clips were manually audio-verified in this session, so scores below are
caption disagreement, not gold-reference WER. Captions include formatting and
written-number conventions that normalization does not fully reconcile.

## Caption-aligned screening

Five ~40-second intervals around 1, 10, 20, 30 and 40 minutes, aligned to caption
segment starts/ends. 539 reference words total. Same mono audio for both models.
Case/punctuation/timestamp labels removed; no spoken-number normalization.

| Model | Pooled caption disagreement | Total edit errors | Inference range |
|---|---:|---:|---:|
| MOSS 0.9B | 18.37% | 99 / 539 | 4.74–5.91s per excerpt |
| Qwen3-ASR 1.7B 8-bit, Malay hint | 22.63% | 122 / 539 | 3.69–5.14s per excerpt |

Examples of disagreements involved proper nouns, colloquial Malay, numbers and
code-switching. Neither result proves definitive superiority on Malay meetings.
No DER/cpWER was measured; subtitles do not give reference speaker labels.

## Full-episode engine stress test

Memoria WindowTranscript with 4s cores, 2s left/right context, VAD and Resemblyzer.
Audio read in 4s chunks and processed faster than real time. Original app models
could remain resident concurrently; no controlled system-idle condition claimed.

Initial implementation stopped after 852s / 14:12 on generation-output limit.
Voice tracker had reached 121 profiles by 14:04 due to treating ambiguous similar
matches as new voices. Fixed by leaving close-score ambiguity unassigned and
bounding new speaker profiles to eight. This prevents runaway fragmentation;
it does not establish correct identity clustering.

Limited per-window generation to 384 tokens (previous 2048). Invalid/truncated
windows record explicit gaps and continue. Full rerun completed:

- Audio: 2686.016s, all fed through the engine.
- Processing: 730.085s / 12m10s, ~3.68× real time.
- 667 output turns, four retained voice profiles; no reference count comparison.
- P95 four-second feed time 1.49s. This is compute, not visible-word latency.
- Retained PCM six seconds during processing, two seconds after final flush.
- Process peak RSS 2.21GB; stable high-water mark across checkpoints, not proof
  of flat total CPU/GPU memory or a leak-free app.
- One explicitly untranscribed interval: 844–848s (14:04–14:08), output limit.
- No terminating failures after the fix. UI review now displays recorded gaps.

This is a sustained model/engine replay, not 44 minutes of wall-clock-paced
microphone capture, native queue/IPC load, Pause/Resume or UI rendering. Those
require separate acceptance tests. Full-episode word accuracy was not scored.

## Reproduction files

Approved temporary directory `/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode`:
`ks-ai.webm`, `ks-ai.wav`, `ks-ai.ms.json3`, `ks-ai.info.json`, `ks-compare.py`,
`ks-sustained.py`, `ks-moss-comparison.json`, `ks-qwen-comparison.json`,
`ks-sustained-result.json`. Original third-party audio/captions stay temporary;
no podcast transcript is committed or published as personal approved knowledge.

Next: create a human-checked development/evaluation subset with time and speaker
labels, compare the actual near-live output to it, then paced/native session test.

## Follow-up: merge-policy investigation

Scoring the original sustained-run turns on timestamp-selected passages found
59.65% caption disagreement (different bounds/reference count from the earlier
539-word excerpt comparison). Inspection exposed repeated overlapping phrases.
Completion/throughput therefore must not be presented as acceptable word accuracy.

A matched 539-word comparison reran the five original excerpt bounds with the
same audio, model and four-second/two-second window policy:

- Exact suffix/prefix merge: 274 edits / 539 = 50.83% disagreement.
- Temporal-overlap-only approximate suffix/prefix alignment: 173 / 539 = 32.10%.
- Four-second nonoverlapping experimental windows: 31.35%.
- Eight-second nonoverlapping experimental windows: 24.30%, but longer live wait.
- Full ~40-second MOSS excerpts previously scored 18.37%.

Approximate merge never rewrites remaining words. It removes overlap text only
when timestamps overlap and speakers match or one is unassigned. Removed text is
retained as `rawWindowText` with `contextTrimmed` for audit. Repetition and omissions
remain; these development results are not held-out WER or calibrated thresholds.

An experiment replacing the entire provisional tail scored 83.86% because MOSS
turn timestamps often cross windows and replacement deleted valid preceding text.
That implementation was discarded, and regression checks retain append/ownership
with guarded overlap alignment. No claim of successful tail replacement remains.

The pathological 842–850s input repeatedly emitted ellipses up to the output cap.
Core-only 844–848s recovered in 0.50s; a wider 840–852s excerpt produced useful
Malay text in 1.42s. Worker now retries a failed window on its core before recording
a gap. Local recovery slice check completed with no gap, although boundary repeats
remain. Seven focused Python tests cover recovery, ambiguity, bounded profiles,
silence, tail flushing and overlap merge. Full-episode rerun of this follow-up
build has not been performed yet.

### Completed follow-up full rerun

The same 2686.016s episode completed after overlap/core-retry changes in
698.528s (11m39s), approximately 3.85× real time. No recorded gaps or terminating
failures. 660 turns, four retained profiles, six seconds retained PCM while
processing/two seconds at completion. P95 four-second feed compute 1.374s;
process RSS high-water mark 2.203GB. Conditions were not controlled for other
system load; this is not a statistically established speedup over the earlier run.

The matched caption-excerpt result remains 32.10% disagreement with residual
repeats/omissions and proper-noun errors. It does not establish that every passage
is correct, that four profiles match actual speakers, or that the native frontend
is leak-free during 45 minutes. Original model text for context-trimmed turns is
retained in the draft for inspection. Seven Python and eight frontend meeting
tests passed; code built and installed before this full-engine rerun. Native
long-session acceptance and human-checked reference scoring remain unfinished.
