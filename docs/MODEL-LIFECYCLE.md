# App-owned model lifecycle

Memoria prepares speech, language generation and retrieval sequentially in the
background at native app startup. The workspace stays interactive. Sidebar
readiness reports Preparing AI, AI ready or AI needs attention, with component
details on hover. Each worker uses a random app-instance Unix socket, mode 0600.

- Speech: Parakeet TDT 0.6B v3 and Nemotron 3 Diarization plus Resemblyzer, one worker shared by successive
  meetings and recording-transcription requests (`MEMORIA_SPEECH_ENGINE=moss` loads MOSS 0.9B instead). Session
  transcript/audio buffers reset for each connection; voice templates remain vault-local.
- The language worker also keeps two caches: the model state after the live check's shared question, and the
  meeting transcript for Live Ask, extended with only the turns added since the last question.
- Generation: Qwen 4-bit, resident mode disables the five-minute idle unload.
- Retrieval: EmbeddingGemma 2 5-bit, warm model/tokenizer used by the existing
  embedding adapter and SQLite query cache.

The app injects managed socket addresses into its request subprocesses. The
subprocesses relay inputs/outputs rather than loading extra model weights. Starting
a meeting still requires speech/model/worklet readiness. Inference is serialized
within each worker, not continuously running. Workers are killed and reaped on
native app exit. Separate app processes do not share workers.

Measured simultaneous worker smoke: speech active MLX 1.817GB, Qwen 2.368GB,
embedding 1.132GB: total 5.317GB excluding CPU allocations, retained allocator
caches and workspace memory. Two empty speech sessions became ready in <1ms on
the private socket; this measures session reuse only, not mic or live-word latency.
Warm embedding output was 768 dimensions. All three processes remained alive.

Python runtimes and HF snapshots can be provisioned for a clean account under
`/Users/Shared/Memoria`; see [the AC7 install steps](GETTING-STARTED.md#install-for-another-macos-account-ac7).
Explicit environment overrides win, then a completed shared install, then the
existing developer environment. This is same-Mac provisioning, not bundled Python.

Limits: a worker that stops is started again by the app's supervision loop (checked every
5 s, at most three starts per worker per run; a killed Qwen worker was back in 4 s in the
`v0.2.0-uat` smoke test, [RELEASE_RECORD.md](RELEASE_RECORD.md)). Memory-pressure eviction
is not implemented. Requests queued behind an active meeting can time out;
cross-worker GPU scheduling is not coordinated. Readiness means models warmed,
not a guarantee of transcription accuracy, queue throughput or publication safety.
CLI engine invocations without app-injected socket variables retain their existing
standalone fallback behaviour. A separate cold/native quit verification is needed
after any lifecycle changes.

Native installation check: the sidebar reported speech preparing with Qwen and
embedding queued. Speech startup stalled on this launch before loading weights;
cause not established. Added a 60-second per-worker preparation deadline to mark
failure and continue preparing the remaining components. Confirmed native app
Quit terminated its owned speech child (PID absent afterwards). Final bundle
rebuilt/reinstalled. 11 focused frontend plus 16 engine tests pass; Cargo check,
TypeScript and diff check pass. Full native all-three-ready and recovery after
failure are not verified.
