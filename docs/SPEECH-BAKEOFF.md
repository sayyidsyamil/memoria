# Local speech spike — 31 October 2026

## MOSS near-live update

Live speech now loads MOSS once per session and processes four-second cores with
two seconds of left/right context, speech-gated using WebRTC VAD plus a small RMS
floor. Context is revisited but only midpoint-owned turns are appended; exact
suffix/prefix repeats are trimmed when timestamps overlap. This is a heuristic,
not a guarantee of no duplicates or omissions. Three-second clean excerpts can
reconcile window-local speakers with Resemblyzer; shorter/overlapping excerpts
remain unassigned. Final flush writes the session draft and passes it to the same
speaker review screen, without automatically running full-recording ASR again.
Missing final event can recover the stored draft through `meeting_draft`.

Direct JFK PCM check initially revealed repeated context. After the merge fix,
final text matched the sample's spoken sentence with no repeated phrases. Exact
silence never invokes MOSS in unit tests. Native recording started and the expanded
screen was navigated; speaker-output playback through `afplay` did not produce
visible captured words (output device/mic path not established). Therefore native
speech-to-visible-word and final review handoff remain partially verified, not a
completed real-meeting acceptance result. Nine focused tests and app build pass.

Meeting UI uses a shared charcoal surface, 22px corners, restrained typography,
consistent review header/body/footer, grouped speaker controls and editable turns.
The main document workspace retains its own light/dark theme. This pass targets
the meeting surfaces, not every legacy screen in the fork.

## Updated user workflow

Live recording now uses one plain Nemotron ASR stream; speaker labels are not
shown or computed for live captions. CC expands to a 600×440 readable transcript,
retains all received text and follows the bottom until the user scrolls away.
End expands into review and automatically runs post-meeting MOSS refinement.
Review displays editable turns, audio playback with seek timestamps, one name
dropdown per detected speaker, and per-turn reassignment. Renaming a speaker
updates all their turns and the published transcript.

Remember named voices is enabled in review and can be unchecked. When checked,
confirmed names are linked to local Resemblyzer 0.1.4 voice embeddings in
`.memoria-memory/voices.sqlite`, scoped to this workspace. At least three seconds
of preprocessed clean speech is required; overlapping or short segments are
excluded. Templates are not updated automatically by unconfirmed matches.
Future post-meeting transcripts compare extracted voices with saved profiles;
cosine >=0.82 and runner-up margin >=0.08 preselect the saved name. Collisions
where two detected voices claim one profile stay unknown. These are conservative
prototype thresholds, not a calibrated biometric identification guarantee.
No cross-workspace profile sharing or automatic naming in live captions occurs.

Mechanism check on distinct excerpts from the public synthetic sample: same
voice cosine 0.933, different voice 0.650. JFK split-half same-voice cosine 0.817
fell below threshold and correctly remained unnamed, illustrating possible false
rejections. Unit checks verify profile persistence, changed session labels,
unknown/ambiguous matches and all-turn rename publication. Native expanded HUD
was screenshot-inspected; microphone permission stall still prevents full live
word verification on the installed app. Direct plain streaming worker verified
incremental text and final flush on JFK.

Resemblyzer software and bundled voice encoder are licensed under Apache-2.0
(Copyright 2019 Resemble.AI): https://github.com/resemble-ai/Resemblyzer

Machine: Apple M5, 16 GB unified memory. MLX-Audio pinned to
`7a0986280fe295f4cf40f64164bb23abed416a22` (package 0.6.3), installed in
`.speech-runtime` with inherited system dependencies. This is development setup,
not standalone application packaging.

## Actual measured checks

- Public whisper.cpp JFK sample: 11 seconds, mono 16 kHz.
- Public HF `dummy-audio-samples/diarization_example.mp3`: 97.6 seconds,
  NVIDIA's synthetic eight-voice release demonstration, converted to mono PCM.
  This is synthetic demo audio, not a held-out real-meeting benchmark.
- Nemotron 3.5 ASR 8-bit revision `7279359e4481b5e9e185a318bd618e429c6d86cd`.
- Nemotron 3 diarization BF16 revision `59ed2dbfc1346dcea9d423c71306a3a2499c568f`.
- MOSS 0.9B revision `704aa4a9c304e8520be88901e0d1960158ef5b15`.

JFK: combined load 10.43s; ASR 0.78s first / 0.40s repeat; diarization 1.19s;
speaker-stream replay 0.58s; process peak RSS 1.19 GB.
97.6s synthetic sample: masked speaker streaming at low diarization / 560ms ASR
lookahead took 12.24s, first output after feeding 1.92s audio; slowest feed 0.456s;
peak RSS 1.45 GB. Replay was faster than real time, not a paced live-latency test.
Speaker errors, duplicate cross-turn words and missed overlap were visible.

MOSS on the synthetic sample: reported generation time 13.89s initial, 13.04s
rerun. Download/initial load took 216s (included model download). Produced nine
speaker IDs for an eight-voice demo. Some proper nouns were wrong. No gold labels
were obtained, so no WER/DER/cpWER claim or overall winner follows from this spike.

## Installed integration

End saves original audio, shows a transcript-review window, and offers Create
transcript. MOSS runs locally via the existing cancellable job transport, with
five-minute watchdog, progress updates, strict vault/audio validation, and
offline-only HF/Transformers model loading. FFmpeg converts a temporary copy.
Initial input limit: ten minutes, rejected visibly above that limit. Output limit
16384 tokens rejects suspected truncation. Longer audio is not silently accepted.

The generated machine draft is stored at
`.memoria-recordings/<session>/transcript-draft.json`. Only Save reviewed transcript
publishes a Source page and text attachment for the memory engine. Review allows
editing words, speakers and timestamp text; timestamps refer to saved-audio time,
not wall-clock time across pauses. Original audio is preserved.

Native OCU verification reached transcript review and completed real local MOSS
inference on a short mic recording. Timestamp-only output on silence was found
and filtered. Focused tests cover capture/review transitions, review publication,
timestamp validation, and silence handling. Live PCM-to-model integration,
system-audio capture, in-app recovery from stored drafts, 45–60-minute sessions,
English–Malay validation, concurrent Ask, and comparative held-out scoring remain
follow-up work.

Live PCM integration is now implemented through a 16 kHz AudioWorklet, a bounded
native session queue, and one persistent local Python worker per HUD session.
CC expands the HUD to show provisional captions; audio recording is independent
of caption failure. End flushes the worklet tail and the model session. The worker
journals speaker-tagged text to `live-transcript.jsonl`. Direct worker verification
on JFK produced incremental words, correct sample text, and final flush completion.
The native installed microphone path subsequently stalled before getUserMedia
resolved, so end-to-end native live captions remain unverified. A 30-second startup
timeout and working End cancellation prevent an indefinitely stuck HUD. Caption
audio before models are ready is currently skipped, so the live journal's clock
is not a citation-grade original-audio clock. The reviewed post-meeting transcript
is the evidence path. Long sessions and queue-pressure testing remain necessary.

## Sources and attribution

- MLX-Audio (MIT): https://github.com/Blaizzy/mlx-audio
- MOSS (Apache-2.0): https://huggingface.co/OpenMOSS-Team/MOSS-Transcribe-Diarize
- Nemotron ASR: https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b
- Nemotron diarization (OpenMDW 1.1): https://huggingface.co/nvidia/Nemotron-3-Diarization
- Official overlap-aware pairing: https://huggingface.co/nvidia/Nemotron-3-Diarization/blob/main/ASR_INTEGRATION_GUIDE.md
- Independent full-recording evaluation: https://voicearena.com/research/diarization-bench/diarization-asr-track-cpwer-results

Masked Nemotron ASR is not trained speaker-kernel Multitalker Parakeet. Do not
present this spike as an implementation or reproduction of that stronger pair.
