# Local speech screening — 31 October 2026

A record of the screening of 31 October. Since 3 November the app uses Parakeet Ultra (a
post-training of Parakeet TDT v3) with Nemotron 3 Diarization; the measurements on meeting
speech that led there are in [research/live-speech](../research/live-speech/README.md).

## Decision

No general meeting-quality winner is established. In this bounded local screen,
Qwen3-ASR 1.7B has the lowest read-speech WER, Parakeet TDT v3 has the fastest
window inference and no silent-window hallucinations, and MOSS is viable for
buffered near-live inference but requires speech gating. Keep the app model
unchanged until a paced live-window merge implementation and meeting references
are evaluated. VibeVoice could not be tested because disk space was exhausted.

## Environment and protocol

Apple M5 / 16 GB. MLX-Audio 0.6.3 at
`7a0986280fe295f4cf40f64164bb23abed416a22`, isolated `.speech-runtime` with shared
system dependencies. Candidates ran sequentially in separate processes.

- First 12 `hf-internal-testing/librispeech_asr_dummy` clean-validation recordings:
  130.47 seconds and 303 reference words. These recordings are read speech, largely
  one speaker. This small familiar set is only a functional screening set.
- Each clip tested clean and with deterministic Gaussian noise at 10 dB SNR.
  Gaussian noise is not a realistic meeting-noise model.
- Normalization removes timestamps/speaker tags, lowercases and strips non-ASCII
  punctuation. Pooled WER uses total edit errors / total reference words.
  No spoken-number normalization was used. The clean and noisy sets are paired,
  not 24 independent recordings.
- Public NVIDIA eight-voice synthetic demo: six 8s cores with up to 2s preceding
  context, plus six excerpts at each of 2/4/8s and exact-zero silence at each width.
  No reference transcripts/RTTMs were acquired for the synthetic demo. Window text
  is recorded but no accuracy metric is claimed for those excerpts.
- Timings include model inference after loading, not network/download time.
  First clip can include kernel compilation. RSS is the process high-water mark,
  not a full GPU allocation measurement. Runs were not repeated as a statistical
  benchmark. Live tests replayed input faster than real time, not wall-clock-paced.

## Matched screening results

| Candidate | Clean WER | Noise 10dB WER | Compute for 130.47s clean | Mean 8–10s window compute | Process peak RSS |
|---|---:|---:|---:|---:|---:|
| Qwen3-ASR 1.7B 8-bit | 2.97% (9/303) | 4.29% (13/303) | 8.59s | 0.811s | 2.21 GB |
| Parakeet TDT 0.6B v3 | 3.30% (10/303) | 6.93% (21/303) | 1.49s | 0.102s | 1.76 GB |
| MOSS-Transcribe-Diarize 0.9B | 3.96% (12/303) | 6.27% (19/303) | 9.29s | 1.178s | 1.78 GB |
| Nemotron 3.5 streaming ASR 0.6B 8-bit | 4.95% (15/303) | 10.89% (33/303) | 5.11s | 0.377s | 1.39 GB |
| VibeVoice-ASR-Streaming 1.5B | Not tested | Not tested | — | — | — |

One word is 0.33 WER points on this set. The Qwen/Parakeet clean difference is
one error and does not establish a statistically reliable accuracy advantage.

### Near-live window sweep

Median compute over six excerpts per width:

| Candidate | 2s audio | 4s audio | 8s audio | Exact-zero silence |
|---|---:|---:|---:|---|
| Parakeet | 0.044s | 0.059s | 0.089s | Empty at all widths |
| Nemotron | 0.076s | 0.154s | 0.316s | Empty at all widths |
| Qwen | 0.266s | 0.409s | 0.720s | Invented “Okay.” / “I'm not sure.” |
| MOSS | 0.572s | 0.679s | 0.924s | Invented words, including a refusal and greeting |

MOSS must not be invoked indiscriminately over silence: a valid-looking timestamp
and speaker tag does not make its generated text real. Qwen also needs a VAD gate.
Current post-meeting MOSS integration filters timestamp-only output but does not
yet have this speech-presence guard; that is a follow-up defect.

MOSS and Qwen can finish four-second windows before the next window arrives, but
latency includes collecting audio. For a 4s hop, approximate average audio wait
is 2s plus computation; first-window wait is 4s plus computation. These are
algorithmic estimates, not measured speech-to-visible-word latency. Overlap,
endpointing and prior context may change the estimate substantially.

Native Nemotron replay on the 97.6s sample emitted first text after 1.536s of audio
had been fed. P95 feed-call compute was 0.034s. This excludes startup loading and
transport and does not reproduce the user's perceived live delay.

## Model pins

- Nemotron: `7279359e4481b5e9e185a318bd618e429c6d86cd`
- MOSS: `704aa4a9c304e8520be88901e0d1960158ef5b15`
- Parakeet: `ed2b7e8c15f9aaa0b5772e2efb986255eaef7e15`
- Qwen: `a8379a2e2f9e313c9292cdf1af4055ab56d50d55`

VibeVoice download failed with `No space left on device`; only its two incomplete
download blobs were removed. Approximately 2GB available afterwards. No existing
user recordings or completed model weights were deleted.

## Reproduction artifacts

Temporary approved directory `/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode`:

- `compare-speech.py`, `speech-window-sweep.py`
- `speech-reference.parquet`, `speech-conversation.wav`
- `comparison-{nemotron,moss,parakeet,qwen}.json`
- `window-sweep-{nemotron,moss,parakeet,qwen}.json`

Run `.speech-runtime/bin/python <temporary>/compare-speech.py <candidate>` and
`.speech-runtime/bin/python <temporary>/speech-window-sweep.py <candidate>`.

## Next bounded experiment

For a single evolving transcript, compare Parakeet overlapping
windows against VAD-gated Qwen and MOSS. Use the same paced PCM stream and a fixed
commit policy, score final words and word revisions, record p50/p95 stable-word
latency, test realistic microphone noise and a real annotated multi-speaker
meeting, and test pauses/final flush. Do not transfer this read-speech ranking
directly to English–Malay code-switching or speaker attribution.
