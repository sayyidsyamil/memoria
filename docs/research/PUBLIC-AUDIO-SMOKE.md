# Public-audio offline file-transcription smoke

A record of 2 November 2026, when the app transcribed with MOSS-Transcribe-Diarize. Since
3 November it uses Parakeet Ultra with Nemotron 3 Diarization; see
[research/live-speech](../../research/live-speech/README.md).

## Result and scope

**PASS:** one invocation of the current `src-tauri/resources/memory/transcribe.py`
completed the AMI IS1009a **30–90s interval (60.000s)**, returning **14 segments**
and a recoverable draft. Wall time was **17.651476s**, giving
**file-transcription wall RTF = 17.651476 / 60 = 0.294191**
(about 3.40 audio-seconds per wall-second).

This is **FILE transcription throughput only, not live latency**. It includes
fresh-process imports, cached model loading, internal conversion/VAD, generation,
CPU voice embeddings and draft saving; the initial clip extraction is excluded.
It does not measure first-caption latency, microphone capture, native UI,
near-live window handling, sustained operation, or accuracy on a representative
meeting sample. One run only; no repeat GPU jobs or downloads.

Run began `2026-11-01T18:05:21.517522+00:00` (2026-11-02 locally).
Exit code **0**; **no timeout** (child limit 290s; outer command limit 300s).
Pipeline-reported `processingSeconds` was **4.914642s**: the source timer surrounds
generation and segment validation, excluding model loading and voice matching.
It is not an end-to-end or live-latency measurement.

## Data, runtime and reproducibility

- Source: `/Users/sayyid/Desktop/FYP/data/ami/audio/IS1009a.wav`;
  AMI public **mixed-headset** data. ffprobe confirms
  one mono PCM signed-16-bit channel, 16kHz, full duration 838.833313s;
  stream metadata does not independently identify the headset mix.
- Attribution: **AMI Meeting Corpus / AMI Project**, meeting IS1009a;
  <https://groups.inf.ed.ac.uk/ami/corpus/>. Local
  `annotations/LICENCE.txt`, lines 1–4, licenses the corpus and annotations
  **CC BY 4.0**: <https://creativecommons.org/licenses/by/4.0/>.
  The scratch clip is a trimmed derivative; original audio was not modified.
- Source SHA-256, equal before and after:
  `6eb5a0ede0d9e72794f976ce7bea5b78133eae969f99b4c5418b43c2468d25b1`.
- Clip: `IS1009a-30-90.wav`, 960,000 samples, 60.000s, mono 16kHz PCM s16le;
  file size 1,920,098 bytes. Clip SHA-256 (also returned by the pipeline):
  `06fb839ba8eef856562e445751a711a64b2cd712919649fd4c602be5f8e799b3`.
- Existing executable: `/opt/homebrew/bin/ffmpeg`, version **8.1.1**.
- Selected existing runtime (verified executable):
  `/Users/sayyid/Documents/memoria-workspace/.speech-runtime/bin/python`;
  Python **3.11.18**, macOS **26.7.1 arm64**.
  Its `pyvenv.cfg` has `include-system-site-packages = true`; this is not a
  hermetic dependency environment. The webrtcvad warning came from Homebrew's
  system site-packages. An initial metadata probe for `webrtcvad-wheels` failed
  because that distribution name is absent; actual `webrtcvad` **2.0.10** is
  available and the transcription ran successfully.
- Package versions: MLX **0.31.2**, mlx-audio **0.6.3**, huggingface-hub **1.15.0**,
  transformers **5.8.1**, soundfile **0.13.1**, resemblyzer **0.1.4**,
  torch **2.12.0**.
- Model: **`OpenMOSS-Team/MOSS-Transcribe-Diarize`**;
  pinned revision **`704aa4a9c304e8520be88901e0d1960158ef5b15`**.
  Existing snapshot:
  `/Users/sayyid/.cache/huggingface/hub/models--OpenMOSS-Team--MOSS-Transcribe-Diarize/snapshots/704aa4a9c304e8520be88901e0d1960158ef5b15`.
  Cached weights `model-00000-of-00001.safetensors` exist (1,817,113,576 bytes);
  snapshot config declares `bfloat16`. No alternate model/runtime was tried.
- `transcribe.py` SHA-256:
  `bf7980e699bd2d497eec49af3baf439345a726e1ca8771d90d7defb8fc8cb561`.
  `live_speech.py` SHA-256:
  `0015964f3ea02e9c29371389ab92ab5230c359acfc5e67b09fb1da0cad4bd931`.

All generated evidence is under scratch:
`/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode/public-audio-smoke`.
macOS resolves this to the equivalent `/private/var/...` absolute path used in
the request. Files: `run_smoke.py`, `request.json`, `evidence.json`,
`stdout.jsonl`, `stderr.log`, `result.json`, `annotation-excerpts.json`, the clip,
and `.memoria-recordings/b936468e-7121-4343-8623-f4e0be7785cf/transcript-draft.json`.
The disposable vault also contains its own empty voice-profile database.

Extraction command (scratch abbreviated as `$SCRATCH`):

```sh
/opt/homebrew/bin/ffmpeg -nostdin -v error -n -ss 30 \
  -i /Users/sayyid/Desktop/FYP/data/ami/audio/IS1009a.wav -t 60 \
  -map 0:a:0 -ac 1 -ar 16000 -c:a pcm_s16le "$SCRATCH/IS1009a-30-90.wav"
```

The unchanged pipeline was invoked with the selected Python using `-B -u`,
JSON on stdin, scratch as working directory, and this request:

```json
{
  "action": "transcribe",
  "audioPath": "/private/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode/public-audio-smoke/IS1009a-30-90.wav",
  "vaultPath": "/private/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode/public-audio-smoke",
  "sessionId": "b936468e-7121-4343-8623-f4e0be7785cf"
}
```

`HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, `HF_DATASETS_OFFLINE=1`,
`HF_HUB_DISABLE_TELEMETRY=1`; `HF_HUB_CACHE` points to the existing cache.
`MEMORIA_SPEECH_SOCKET` was removed from the child environment to invoke the
file script directly. `MEMORIA_FFMPEG` points to the existing executable.
`PYTHONDONTWRITEBYTECODE=1`; temp, Matplotlib, XDG and Torch cache paths were
redirected into scratch. The script itself uses `local_files_only=True` for
the pinned snapshot. No download/install command was issued.

Pre/post process checks showed existing speech, Qwen and embedding resident
servers sleeping at 0% CPU, with unchanged accumulated CPU times across the run.
Only one new transcription model job was launched. This is not an otherwise
quiescent-machine performance benchmark.

## Output evidence

Four **provisional** labels (`S01`–`S04`), no saved profiles or name matches.
Times below are **clip-relative**, with original source time = clip time + 30s.
Text is reproduced from validated output segments, without corrections.
Raw timestamp-tagged `result.text` is retained in `result.json`.

| Clip start–end (s) | Label | Machine draft text |
| --- | --- | --- |
| 24.91–26.62 | S01 | Okay, everybody ready? |
| 25.65–26.12 | S02 | Okay. |
| 26.84–27.21 | S03 | Yeah. |
| 27.18–27.71 | S02 | I think so. |
| 27.64–30.88 | S01 | Uh, I think the first thing we do is introduce ourselves. |
| 31.48–32.45 | S02 | Yeah, that's a good plan. |
| 31.92–37.29 | S01 | And, uh, miss name and what your function is, so maybe we start with you. |
| 36.54–46.05 | S04 | Okay, yeah, my name is Franzena, and I'm a, an user interface, my role is, uh, the main responsibility is user interface. |
| 46.04–46.55 | S02 | Mm-hmm. |
| 46.56–50.89 | S04 | And my role is to design a, a television remote control. |
| 50.98–52.16 | S01 | Mm-hmm, okay. |
| 53.31–56.98 | S02 | And I'm a marketing person, I wanna figure out how to sell them. |
| 57.41–58.66 | S01 | Mm-hmm, and your name is? |
| 58.78–59.72 | S02 | My name is Eileen. |

## Warnings, annotation checks and limitations

Returned warnings, verbatim:

1. Machine draft: review words, timestamps and speaker labels against the audio.
2. Speaker labels are anonymous; overlap may cause missing words or incorrect assignments.
3. Pauses are omitted from the recording clock. Timestamps refer to saved audio, not wall-clock time.

Warning 3 is a generic pipeline message: **this file extraction did not remove
pauses**; its timestamps are relative to the continuous 60s clip.
stderr contained one `webrtcvad.py` warning that `pkg_resources` is deprecated
and slated for removal; no voice-matching-unavailable warning or pipeline error.

Read local `annotations/00README_MANUAL.txt` (declares manual release 1.7,
2014-06-16) and all four `words/IS1009a.{A,B,C,D}.words.xml` files' interval
annotations, retaining time-filtered lexical excerpts in scratch. The local
directory also contains a ZIP named 1.6.2; the README declaration alone does
not independently establish provenance of every unpacked file.

Qualitative annotation comparisons, **not scored accuracy**:

- A has “everybody's name” at source 62.72–63.61s; the draft instead says
  “miss name” in the corresponding passage.
- B spells the name **Francina** at 68.09–69.09s; the draft spells **Franzena**.
- A annotates “Mm-hmm” at 76.08–76.43s, but its corresponding draft turn is
  labelled S02, while the main A opening turn is S01. Thus four labels are
  not evidence of correct speaker attribution.
- Overlap exists, e.g. A's opening at 54.95–57.69s overlaps D's “Okay” at
  55.70–56.03s and C's “Yeah” at 56.90–57.04s. These annotation times broadly
  correspond to draft times after adding the 30s clip offset.

**WER was not calculated and no WER is claimed.** Reliable speaker/channel
alignment for the provided mono mix was not independently established, and no
reference ordering/scoring protocol for overlapping speakers was validated.
Concatenating time-filtered speaker annotations would produce an
unjustified reference. No DER or speaker-identification accuracy is claimed.

Inspection confirms the file path performs one whole-clip generation with
`max_tokens=16384`, `temperature=0.0`, a 600s input limit, VAD and timestamp
validation, followed by CPU resemblyzer matching and draft persistence.
`live_speech.py` instead defaults to 4s core hops with 2s context, 384-token
window generations, warmup, boundary ownership/retries and cross-window voice
reconciliation. It was read, but its live session was not run. This successful
file smoke cannot validate those live mechanisms or their latency.

No pipeline code or source data was changed, and no microphone or native app was used.
