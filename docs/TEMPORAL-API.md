# Temporal memory and live assistance API

The preserved FYP ledger is an application backend, not a second desktop app.
It lives under each vault's `.memoria-memory/temporal/`. The other Dock app and its
registry are not modified.

## Temporal operations

Frontend `temporalService` invokes Tauri `temporal_api` with
`{ vaultPath, method, params }`. Rust validates workspace access; the Python adapter
opens the preserved ledger within the memory engine's workspace lock.

- `overview`: registry, current facts, pending proposals, invariant status.
- `registry.set`: add typed tracked items and attributes.
- `ingest_reviewed_meeting`: read a saved reviewed meeting by ID; validate source
  text against saved turns; preserve actual saved date, speaker, and offsets;
  extract through the shared Qwen worker with `confirm_all` review policy.
- `proposals.accept` / `proposals.reject`: explicit human disposition.
- `facts.history`, `facts.correct`, `facts.retract`: preserve history; corrections
  and retractions require reasons.
- `query`: current, past-valid-date, as-known cutoff, or change count. Change counts
  include history and its evidence rather than an unsupported bare number.

Compiled wiki approval and temporal fact approval are separate. This avoids
silently promoting every generated paragraph into a structured decision.

## Live assistance

`live_memory_check` accepts a bounded statement and inspects approved temporal
facts. Transparent lexical relevance bounds candidate selection; warnings expose
its limits. Exact numeric mismatch checks require comparable labels, attributes,
units and evidence scope. Other comparisons use a narrow shared-model verifier,
with validated fact IDs and source quotes. No check writes or approves memory.

Record view contains an explicit opt-in. Completed earlier transcript turns are
checked serially; the newest turn is provisional. Cues are deduplicated and retain
evidence. They are review prompts, not declarations that a speaker lied. The final
turn has not been checked until a later turn establishes completion; this latency
and completeness trade-off needs measured evaluation.

`live_ask` accepts an explicit question. Session text is bounded but deliberately
excluded from answer generation until safe reference-resolution is implemented.
Answers use approved knowledge; the live adapter requires each displayed factual
statement to be an exact/normalized contiguous span of its cited quote. Unsupported
paraphrases fail closed. This conservative gate sacrifices expressiveness for
source fidelity. Without eligible approved knowledge it does not invent a
session-only answer. UI cancellation is not yet exposed in the small live Ask panel.

## Evidence and limits

Live reads reject symlinked storage paths, use valid-now facts rather than future
scheduled claims, and suppress corrected-value cues supported only by inherited
contradictory quotes. Completed checks acknowledge turns; transient failures retry
at most twice. Caller-owned live-check jobs are cancelled on disable/unmount.

Original engine files are preserved; integration adapters are new. Original
auditor/guard benchmark results do not apply to this new live adapter. See
`docs/research/` for separated historical evidence, deterministic tests, and dated
real-model/file-transcription smokes. End-to-end live speech latency, spontaneous
meeting false-alert rates, and UAT remain unmeasured.
