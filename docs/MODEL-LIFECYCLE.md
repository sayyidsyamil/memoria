# App-owned model lifecycle

Memoria prepares speech, language generation and retrieval one after another in the
background when the native app starts; the workspace stays usable meanwhile. The footer
shows Speech, Knowledge and Search as Queued, Preparing, Ready or Needs attention, with
details on hover. Each worker uses a random app-instance Unix socket, mode 0600.

- Speech: Parakeet Ultra 0.6B and Nemotron 3 Diarization plus Resemblyzer, one worker shared by successive
  meetings and recording-transcription requests (`MEMORIA_SPEECH_ENGINE=moss` loads MOSS 0.9B instead). Session
  transcript/audio buffers reset for each connection; voice templates remain vault-local.
- Generation: Qwen3.5-4B 4-bit; resident mode disables the five-minute idle unload. The worker also keeps two
  caches: the model state after the live check's shared question, and the meeting transcript for Live Ask,
  extended with only the turns added since the last question.
- Retrieval: EmbeddingGemma 2 5-bit, warm model/tokenizer used by the existing
  embedding adapter and SQLite query cache.

The app injects managed socket addresses into its request subprocesses. The
subprocesses relay inputs/outputs rather than loading extra model weights. Starting
a meeting still requires speech/model/worklet readiness. Inference is serialized
within each worker, not continuously running. Workers are killed and reaped on
native app exit. Separate app processes do not share workers.

Memory. MLX keeps every freed GPU buffer for reuse, without limit by default. Decoding speech windows of changing
lengths, the speech worker once grew to a 9.2 GB footprint (models 1.5 GB) and the Mac went into swap, so a 0.2 s live
check took 15 s. Each resident worker now caps the cache at 256 MB (`worker_lifetime.limit_gpu_cache`), a finished
meeting clears it, and the embedding worker drops EmbeddingGemma's audio and vision towers, which Memoria never uses
(1.13 GB of weights becomes 0.19 GB, embeddings bit-identical). Measured footprints after a test meeting, before the
tower change: speech 1.9 GB, Qwen 3.0 GB, embedding 1.7 GB. In the `v0.3.0-uat` smoke test, after two meetings:
speech 2.1 GB, Qwen 3.1 GB, search 0.9 GB ([RELEASE_RECORD.md](RELEASE_RECORD.md)).

Python runtimes and HF snapshots can be provisioned for a clean account under
`/Users/Shared/Memoria`; see [the AC7 install steps](GETTING-STARTED.md#install-for-another-macos-account-ac7).
Explicit environment overrides win, then a completed shared install, then the
existing developer environment. This is same-Mac provisioning, not bundled Python.

Limits: a worker that stops is started again by the app's supervision loop (checked every
5 s, at most three starts per worker per run; a killed Qwen worker was back after 2 s in the
`v0.3.0-uat` smoke test, [RELEASE_RECORD.md](RELEASE_RECORD.md)). Each start has 300 s to
become ready; the limit was 60 s until the M2 check saw all three attempts fail while other
apps held most of the memory ([M2](research/M2-MEETING-INTELLIGENCE.md)). Memory-pressure
eviction is not implemented. Requests queued behind an active meeting can time out;
cross-worker GPU scheduling is not coordinated. Readiness means models warmed,
not a guarantee of transcription accuracy, queue throughput or publication safety.
CLI engine invocations without app-injected socket variables retain their existing
standalone fallback behaviour. A separate cold/native quit verification is needed
after any lifecycle changes.

The first native installation check found speech preparation stalled once before
loading weights (cause not established), which led to the per-worker preparation
deadline; Quit ended the app's speech worker.
