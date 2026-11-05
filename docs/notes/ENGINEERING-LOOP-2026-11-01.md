# Resident-model and live-transport engineering loop

## Confirmed changes

- Native app reached all-three `AI ready`: speech, Qwen, embedding.
- Model manager records load duration and attempt, monitors process death and
  retries failed workers at most three launches per app instance.
- Deliberately terminated the app's idle embedding child; replacement PID appeared
  within eight seconds while speech/Qwen stayed resident.
- Live relay no longer times out after 120 seconds without transcript output.
- PCM commands now return only after worker acknowledgement of consumed audio,
  instead of filling the native queue independently of inference.
- Frontend retains bounded pending audio (30s), with explicit failure on sustained
  backlog. Tail/End waits report errors instead of silently accepting a timed-out
  transcript. Model finalization deadline increased to 60s.
- AudioContext teardown is bounded and retry-safe; queued PCM drains before End.

## Measurements

Paced public 11s JFK WAV, mono 16kHz, two sessions per resident MOSS process:

| Policy | First transcript, run 1 / 2 | End-to-draft, run 1 / 2 | Result |
|---|---|---|---|
| 4s core + 2s context | 8.24 / 6.67s | 0.64 / 0.54s | Correct sentence, no repeated phrases |
| 3s core + 1s context | 5.17 / 4.52s | 0.43 / 0.42s | Duplicated “ask”, broken punctuation |

Kept default 4s/2s. Smaller policy can be selected explicitly through environment
for experiments but is not the production default. All 43 PCM messages were
acknowledged in each session. Session readiness <1ms after model load; this excludes
microphone permission, UI startup and actual first-word latency.

Native warm meeting check: microphone capture started, End returned a reusable
draft containing “Hello, test one, two, three.”, and the review exposed editable
turn/audio/Speaker dropdown without running full-recording ASR. Brief speech was
unassigned, as expected without sufficient enrollment audio. Closed review without
publishing test claims. Original recording saved in disposable vault-p3.

Checks: Cargo check, owned-process-group cancellation test, TypeScript, scoped
lint, diff check, eight meeting UI tests and three window/merge/silence tests pass.
Bundle built and installed; native `AI ready` and review handoff inspected.

## Remaining engineering

Long-meeting, microphone device changes/sleep, returning real-speaker accuracy,
current-vs-historical knowledge routing, model memory-pressure handling and
held-out WER/cpWER/latency remain unverified. Cross-worker GPU arbitration is not
implemented. Automatic retries are bounded rather than infinite. Resident speech
serializes sessions; abandoned-session EOF resets before the next client. Full
memory-pressure and hard-crash recovery are separate work. No “perfect” or
all-workloads speed guarantee follows from these checks.
