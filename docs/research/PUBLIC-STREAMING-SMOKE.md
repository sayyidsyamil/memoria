# Public AMI streaming file-replay smoke

A record of 2 November 2026: live captions then came from MOSS windows
(`live_speech.WindowTranscript`). Since 3 November they come from Parakeet Ultra reading
stretches of speech; see [research/live-speech](../../research/live-speech/README.md).

## Result and scope

**PASS for one bounded, offline model-only replay:** the prepared AMI IS1009a
30–90s clip (60.000s) was delivered as **240 indexed chunks of 4,000 samples**
(0.250s at 16kHz), and all **240 acknowledgements (indices 0–239)** arrived in
sequence. The unchanged live pipeline emitted **15 transcript events: six empty,
nine nonempty/text-changing**, and persisted **15 final segments**. Exit code 0;
no timeout, emitted error, or explicit transcript gap.

This tests file PCM replay through the real MOSS live-window implementation,
including warmup, VAD, CPU voice embeddings, overlap handling and draft saving.
It does **not** exercise a microphone, AudioWorklet, Tauri/browser transport,
resident relay, UI rendering or full capture path. It is one run on a busy Mac,
not a sustained real-time guarantee. **No WER, DER or speaker accuracy was scored.**

The benchmark began `2026-11-01T18:47:46.833466+00:00` (November 2 locally).
The child had a **290s** deadline, killed as a process group if exceeded; the
outer command had a **300s** timeout. Only one model replay was launched; the
subsequent analysis command only read logs. No downloads, installs or commits.

## API and method

At the time of this run, `src-tauri/resources/memory/live_speech.py` exposed
`WindowTranscript(model).feed(samples, final=False)` and `run(model=None)`, the
latter reading newline-delimited JSON:

1. Initial request: `vaultPath` and UUID `sessionId`.
2. Wait for `{"stage":"Live captions ready"}`.
3. Send `{"index":0,"data":"<base64>"}` and sequential indices thereafter.
   `data` must be **little-endian float32**, not the clip's raw signed-16-bit PCM;
   each chunk must contain 1–16,384 finite samples (lines 198–203).
4. Send `{"end":true}` to drain and save the final draft (lines 179–197).

The harness read the existing mono s16le WAV, asserted 16kHz/960,000 samples,
converted samples with `float32(int16) / 32768`, and encoded `<f4` bytes.
It sent the first 0.250s chunk **after 0.250s of replay time**, then used absolute
0.250s deadlines. This avoids supplying future audio at replay time zero.
It did not wait for each ack: nonblocking stdin and simultaneous stdout reads
allow delivery while generation is running. A full JSON line accepted by the
OS pipe counts as **delivered**; the child session's `total` counts as
**ingested**; an ack means `feed()` has returned, including any window decoding.
These are deliberately separate clocks, not an inferred application queue.

The scratch `worker.py` imports the real backend and calls `live_speech.run()`.
It wraps `emit()` only to add UTC/monotonic timestamps and session total/committed
sample counts, and wraps `feed()` only to retain the session reference before
calling its original implementation. Model generation, decoding, ownership,
speaker assignment and finalization remain unchanged. The `committed` value in
a transcript event is the **core start**, since the backend advances it after
emitting. Timestamps are measured at emission; delivered counts are measured at
parent receipt. Both are preserved in the journal.

Defaults were pinned explicitly to **4s core hops and 2s context**. Nonfinal
decoding therefore triggers at ingested audio 6, 10, …, 58s; `end` flushes the
56–60s final core. Window generation uses the actual 384-token limit and
temperature 0, with backend core retry behavior intact.

## Exact timing results

Displayed timings are rounded to six decimals; full precision is in
`evidence.json` and `analysis.json`. Startup wall zero is immediately before
spawning the child; replay zero is after receiving readiness.

| Measurement | Seconds / count |
| --- | ---: |
| Preparing event, relative to launch | 0.299047 |
| Warmup stage event, relative to launch | 4.633651 |
| Ready event, relative to launch | 5.256192 |
| Last audio delivery, relative to replay start | 60.004427 |
| First transcript event (empty), relative to replay start | 6.724007 |
| First nonempty update, relative to replay start | 31.451468 |
| First nonempty update, relative to launch | 36.707771 |
| Audio delivered at first nonempty receipt | 30.750000 |
| Audio ingested at first nonempty emission | 30.000000 |
| First nonempty update's latest segment end | 27.710000 |
| First nonempty lag from first draft segment start (24.91s) | 6.541468 |
| First nonempty lag from first draft segment end (25.45s) | 6.001468 |
| Done emission, relative to replay start | 61.012239 |
| Done emission, relative to launch | 66.268541 |
| Final drain: last audio delivery → done emission | **1.007812** |
| Final drain: end message accepted → done emission | **1.007749** |
| Child exit observed, relative to launch | 66.802168 |
| Supervisor wall, including post-run bookkeeping | 66.830904 |
| Maximum complete-chunk delivery → ack emission | 1.504069 |
| Maximum delivered-but-unacknowledged audio | 1.000000 |
| Maximum pipe write duration | 0.498994 |
| Maximum delivery schedule lateness | 0.511003 |
| Maximum gap between complete audio deliveries | 0.750847 |
| Maximum gap between ack emissions | 1.749155 |
| Maximum gap between transcript events | 4.889980 |
| Maximum gap between nonempty transcript events | 4.586693 |
| Final segments / acknowledgements / explicit gaps | 15 / 240 / 0 |

The initial nonempty delay includes the clip's opening without readable speech;
the earlier six gated windows emitted empty text. VAD firing is not evidence
that intelligible speech exists in every window. Segment-relative latency above
uses the model's draft timestamps, not independently scored speech onset.

Input pacing finished only 0.004427s beyond its 60s target, but individual chunks
experienced pipe backpressure and subsequent deadline catch-up. **Strict evenly
spaced real-time delivery was not achieved.** Maximum delivered-unacknowledged
audio excludes a partially written line and any not-yet-delivered scheduled
audio. The maximum delivery-to-event time was **1.504029s** (40–44s core);
this includes possible prior queueing, VAD/decode/embedding/merge work and is
not a pure model-generation timer. Final-core update occurred 0.996862s after
last delivery. Empty-window event times were 0.414175–0.713743s after their
trigger chunk; nonempty regular-window times were 0.919956–1.504029s.

### Every emitted transcript update

UTC date is `2026-11-01` for every row. Replay wall is measured at child emission.
Delivered audio is counted at parent receipt; ingested and core start are
counted in the child. Cumulative segments include an empty transcript's zero.

| UTC time | Replay wall (s) | Delivered (s) | Ingested (s) | Core start (s) | Segments | Latest segment end (s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 18:47:58.951371 | 6.724007 | 6.50 | 6 | 0 | 0 | — |
| 18:48:02.831120 | 10.603731 | 10.50 | 10 | 4 | 0 | — |
| 18:48:06.643093 | 14.415690 | 14.25 | 14 | 8 | 0 | — |
| 18:48:10.793984 | 18.566566 | 18.50 | 18 | 12 | 0 | — |
| 18:48:14.665833 | 22.438395 | 22.25 | 22 | 16 | 0 | — |
| 18:48:18.788943 | 26.561488 | 26.50 | 26 | 20 | 0 | — |
| 18:48:23.678937 | 31.451468 | 30.75 | 30 | 24 | 4 | 27.71 |
| 18:48:27.715656 | 35.488161 | 34.75 | 34 | 28 | 6 | 32.45 |
| 18:48:31.493694 | 39.266185 | 38.75 | 38 | 32 | 7 | 37.26 |
| 18:48:35.151591 | 42.924068 | 42.75 | 42 | 36 | 8 | 41.97 |
| 18:48:39.738312 | 47.510761 | 46.75 | 46 | 40 | 9 | 45.98 |
| 18:48:43.354505 | 51.126953 | 50.75 | 50 | 44 | 10 | 46.56 |
| 18:48:47.413772 | 55.186197 | 54.75 | 54 | 48 | 12 | 52.16 |
| 18:48:51.599687 | 59.372093 | 58.75 | 58 | 52 | 13 | 56.98 |
| 18:48:53.228894 | 61.001290 | 60.00 | 60 | 56 | 15 | 59.72 |

Ready UTC was `18:47:52.227234`; done UTC was `18:48:53.239847`.
The first nonempty event text was exactly:
`Okay. Okay. Everybody ready? Yeah, I think so.`
Full cumulative text, turns and every ack/stage/error timestamp are in the logs.

## Output defects and recommendations

No API failure or fatal backend defect occurred.

**Observed timestamp/text inconsistency after context trimming:** final segment 9
has start **38.00s**, end **45.98s**, speaker S01 and trimmed text
`is uh the main responsibility is User Interface.` Its preserved `rawWindowText`
is `France Sina and I'm uh a User Interface, my role is uh the main responsibility
is User Interface.` The preceding segment spans **36.55–41.97s** and ends
`my role.`. In `live_speech.py` lines 134–139, overlap trimming replaces the text
but leaves its original start/end unchanged; the continuation is consequently
still timed at the start of the removed prefix. This is a concrete metadata
defect visible in this run, not evidence that all genuine overlap is wrong.

**Fix recommendation:** make overlap alignment return the retained-word
boundary as well as text. With reliable word timing, advance the retained text's
start to that boundary. With only segment timing, retain the raw segment interval
explicitly and mark trimmed-text timing as unresolved; do not silently present
38.00s as the aligned start of the continuation or estimate it by word-count
ratio. Consider revising/merging the overlapping same-voice turn when its
identity can be established, rather than appending an independently timed
fragment. Do not blanket clamp to the previous end: genuine speakers overlap.
The fix was applied afterwards ([cadence follow-up](PUBLIC-STREAMING-CADENCE.md#fixed-timing-contract)).

Other observed limitations:

- **12 of 15 turns are `unassigned`**, two S01 and one S02; no profile matches.
  Short and overlapping turns do not meet `speaker_embeddings()`'s isolated
  audio thresholds. The same introduction switches from unassigned to S01.
  These labels are provisional, not verified identities.
- Draft text includes `Miss Name` and `Franzena`, retained without correction.
  The prior public-file smoke documents corresponding AMI annotation spelling
  discrepancies. No new reference alignment or WER scoring was performed.
- Six empty `Live transcript` events are emitted without a text change. A
  text/turn-change guard before emitting would avoid misleading update counts
  and redundant UI traffic, while preserving stages and acks.
- `run()` synchronously calls `feed()` before acknowledging (lines 202–203),
  producing measured pipe backpressure during decode. A future live transport
  should distinguish ingestion acknowledgement from transcription progress and
  use a bounded, observable input queue with explicit overload/gap reporting.
  This run does not establish browser/native queue behavior.

**Recommendation:** keep this as a successful model-only replay smoke, fix the
trimmed-text timestamp contract, and instrument bounded queue behavior before
making live-latency claims. Evaluate the full capture path separately and use a
validated overlap-aware reference protocol before claiming accuracy.

## Data, environment, integrity and log paths

Source attribution is **AMI Meeting Corpus / AMI Project**, public mixed-headset
meeting IS1009a, as identified in the prepared smoke. Corpus and local annotation
license: **CC BY 4.0**. See [the existing file smoke](PUBLIC-AUDIO-SMOKE.md) for
inspectable local provenance and license references. The clip was reused as-is;
no extraction or download was performed.

- Original source: `/Users/sayyid/Desktop/FYP/data/ami/audio/IS1009a.wav`.
  SHA-256 before/after:
  `6eb5a0ede0d9e72794f976ce7bea5b78133eae969f99b4c5418b43c2468d25b1`.
- Clip: `public-audio-smoke/IS1009a-30-90.wav`, 1,920,098 bytes;
  SHA-256 `06fb839ba8eef856562e445751a711a64b2cd712919649fd4c602be5f8e799b3`.
- Existing Python: `/Users/sayyid/Documents/memoria-workspace/.speech-runtime/bin/python`,
  Python 3.11.18, macOS 26.7.1 arm64; existing non-hermetic cached runtime.
- MLX 0.31.2, mlx-audio 0.6.3, huggingface-hub 1.15.0, transformers 5.8.1,
  soundfile 0.13.1, webrtcvad 2.0.10, resemblyzer 0.1.4, torch 2.12.0.
- Model `OpenMOSS-Team/MOSS-Transcribe-Diarize`, pinned revision
  `704aa4a9c304e8520be88901e0d1960158ef5b15`; existing snapshot under
  `/Users/sayyid/.cache/huggingface/hub/models--OpenMOSS-Team--MOSS-Transcribe-Diarize/snapshots/704aa4a9c304e8520be88901e0d1960158ef5b15`.
- `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, `HF_DATASETS_OFFLINE=1`, telemetry
  disabled; backend uses `local_files_only=True`. Resident socket environment
  removed; temporary/Torch/XDG/Matplotlib paths redirected to owned scratch.
- Backend hashes match before/after: `live_speech.py`
  `0015964f3ea02e9c29371389ab92ab5230c359acfc5e67b09fb1da0cad4bd931`,
  `transcribe.py`
  `bf7980e699bd2d497eec49af3baf439345a726e1ca8771d90d7defb8fc8cb561`,
  `voice_profiles.py`
  `783db4882b7d91b7e82ca850fd6d2361f843afc27ecd1cd450e09962b20d62b9`.

Original scratch was inventoried recursively with size and SHA-256 **before and
after**, including its clip, original results, logs, annotation excerpts, vault
and cache files. Inventories match exactly. Its top-level entries were
`.memoria-memory/`, `.memoria-recordings/`, `annotation-excerpts.json`, `cache/`,
`evidence.json`, `IS1009a-30-90.wav`, `request.json`, `result.json`, `run_smoke.py`,
`stderr.log`, `stdout.jsonl`, and `torchinductor_sayyid/`.

Pre/post process snapshots show the existing Qwen resident PID 68357 at 0% CPU
and unchanged accumulated CPU time 0:04.27. No other model test was launched by
this task. System `mediaanalysisd`, Spotlight and browser processes were busy;
the machine was not otherwise quiescent. stderr contains only the existing
webrtcvad `pkg_resources` deprecation warning.

All new benchmark artifacts are under:

```text
/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode/public-streaming-smoke/
```

macOS `/private/var/...` is the equivalent resolved path used inside logs.

- `replay.py`, `worker.py`: exact replay and timestamp instrumentation.
- `request.json`: disposable vault request/session UUID.
- `events.jsonl`: every delivery/write, emitted event, stage, ack and exit with
  UTC, monotonic, launch/replay wall and delivered/acknowledged audio clocks.
- `stdout.jsonl`: child JSON with original payload plus `_benchmark` timestamps.
- `stderr.log`: warning/error stream.
- `evidence.json`: runtime, input integrity, full-precision timing, cumulative
  update text, before/after backend hashes and status.
- `analysis.json`, `analyze.py`: log-only derived timing details.
- `result.json`: emitted final draft, including all segments and warnings.
- `.memoria-recordings/bcc53266-7104-4950-b100-cf357626efb2/transcript-draft.json`:
  backend-persisted draft, retaining voice embeddings.
- `original-inventory-before.json`, `original-inventory-after.json`: original
  scratch integrity evidence.
- `processes-before.txt`, `processes-after.txt`: process/load evidence.
- `.memoria-memory/voices.sqlite` and runtime cache files: disposable new vault.

Invocation used the existing `.speech-runtime/bin/python -B -u` on scratch
`replay.py`. The directory's logs are single-run artifacts; do not rerun in
place and overwrite this evidence.
