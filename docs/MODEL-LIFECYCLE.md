# App-owned model lifecycle

Memoria prepares speech, language generation and retrieval sequentially in the
background at native app startup. The workspace stays interactive. Sidebar
readiness reports Preparing AI, AI ready or AI needs attention, with component
details on hover. Each worker uses a random app-instance Unix socket, mode 0600.

- Speech: MOSS 0.9B plus Resemblyzer, one worker shared by successive meetings
  and recording-transcription requests. Session transcript/audio buffers reset
  for each connection; voice templates remain vault-local.
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

Limits: development Python environments are still machine-local. Worker crashes
are surfaced by readiness polling; automatic restart and memory-pressure eviction
are not implemented yet. Requests queued behind an active meeting can time out;
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
