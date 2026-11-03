# Streaming cadence and overlap timing follow-up

A record of 2 November 2026 about the MOSS live windows, which `MEMORIA_SPEECH_ENGINE=moss`
still uses. Since 3 November the app's live captions read stretches of speech with Parakeet
Ultra instead; see [research/live-speech](../../research/live-speech/README.md).

## Decision

Keep the **4-second core / 2-second context** default. A single 2-second-core
experiment provided earlier partial captions but increased backpressure and End
drain. This is not enough evidence to adopt it globally or change speech models.

The baseline's first readable caption at replay +31.451 seconds includes six
decoded windows with no readable text. It is not a measured 31-second model delay.
The first draft speech starts at +24.91 seconds; neither its onset nor word accuracy
was independently scored.

## Same public fixture, sequential offline runs

All runs replayed AMI IS1009a 30–90 seconds as 240 float32 0.25-second chunks at
16 kHz, using the same pinned MOSS model. No microphone, browser transport,
resident relay, UI latency, WER or DER was tested. Source and original scratch
integrity checks passed. The two new runs used the timing patch below; the baseline
used the preceding implementation. Tests alongside patched-4 were CPU-only mocks.

| Measurement | Original 4s | Patched 2s | Patched 4s |
| --- | ---: | ---: | ---: |
| First readable caption after replay start (s) | 31.451468 | 28.925594 | 31.423663 |
| Maximum delivery-to-ACK delay (s) | 1.504069 | 2.110585 | 1.421727 |
| End drain after last audio delivery (s) | 1.007812 | 1.898838 | 1.037424 |
| Maximum pipe write duration (s) | 0.498994 | 1.110684 | 0.420466 |
| Maximum delivery lateness (s) | 0.511003 | 1.122764 | 0.424341 |
| Caption events / final segments | 15 / 15 | 13 / 18 | 9 / 15 |
| Sequential acknowledgements | 240 | 240 | 240 |
| Explicit gaps / errors | 0 / 0 | 0 / 0 | 0 / 0 |

Original 4s emitted six empty caption events; patched implementations publish only
when accepted turns change. All patched events contained text. Differences in
transcript segmentation and wording are preserved in results, not accuracy scores.
The 2s run first published `Okay. Okay.`; patched-4 first published
`Okay. Okay. Everybody ready? Yeah, I think so.`

Startup readiness varied (5.256 / 8.767 / 5.518 seconds), reinforcing that these
are single-run operational measurements on a non-quiescent machine.

## Fixed timing contract

Overlap trimming has only segment timestamps, so it cannot infer the start of
retained words. A trimmed turn now preserves `rawWindowText`, `rawWindowStart`,
`rawWindowEnd`, `contextTrimmed: true` and
`timingStatus: "unresolved-context-trim"`. Existing start/end are original replay
anchors, not retained-word alignment. No word-count interpolation or blanket
clamping to the preceding end is used.

The review UI labels these anchors `unaligned`; exported transcripts and meeting
pages identify the original interval and unresolved text timing. Refinement from
the saved recording is available. Temporal ingestion rejects such turns before
inference/source insertion, instead of creating falsely precise fact citations.
This protects the temporal adapter; other wiki retrieval offsets remain approximate
and are not certified word alignments.

Patched-4 persisted the observed problematic continuation with original interval
38.00–45.98 seconds and explicit unresolved status. Raw and final files are retained.

## Reproducibility and remaining work

See [baseline method and attribution](PUBLIC-STREAMING-SMOKE.md). New isolated
artifacts under the pre-approved scratch root `opencode/`:

- `public-streaming-hop2/`: started `2026-11-01T18:56:59.402019Z`.
- `public-streaming-patched4/`: started `2026-11-01T18:58:35.902400Z`.

Each contains `replay.py`, `worker.py`, `evidence.json`, `events.jsonl`,
`stdout.jsonl`, `result.json`, stderr, and its saved disposable draft. Wrappers
reuse the preserved baseline harness; hop2 substitutes only the core environment
setting. Backend SHA-256 during both new runs:
`2655a7ffd9143d9439f310a43a50c4c9596e1d3f93b6172635bc1ffa28e3894e`.

Next: observable bounded transport queue, explicit completed-turn semantics,
and native prerecorded integration. ACK still follows synchronous decoding;
these measurements do not establish the full capture path's latency.
