# Temporal memory and live assistance API

The preserved FYP ledger is an application backend, not a second desktop app.
It lives under each vault's `.memoria-memory/temporal/`.

## Temporal operations

Frontend `temporalService` invokes Tauri `temporal_api` with
`{ vaultPath, method, params }`. Rust validates workspace access; the Python adapter
opens the preserved ledger within the memory engine's workspace lock.

- `overview`: registry, current facts, pending proposals, invariant status.
- `registry.set`: add typed tracked items and attributes.
- `ingest_reviewed_meeting`: read a saved reviewed meeting by ID; validate source
  text against saved turns; preserve actual saved date, speaker, and offsets;
  extract through the shared Qwen worker (long meetings in windows, through the
  evaluated `WindowedExtractor`) with `confirm_all` review policy.
- `proposals.accept` / `proposals.reject`: explicit human disposition.
- `facts.history`, `facts.correct`, `facts.retract`: preserve history; corrections
  and retractions require reasons.
- `query`: current, past-valid-date, as-known cutoff, or change count. Change counts
  include history and its evidence rather than an unsupported bare number.

Compiled wiki approval and temporal fact approval are separate. This avoids
silently promoting every generated paragraph into a structured decision.

## Live assistance

`live_memory_check` (`live_assistance.py`) accepts a bounded statement and reads only
current approved facts, never superseded values or pending proposals. No check writes
or approves memory.

- Candidates: facts whose item or attribute shares words with the statement and, through
  the resident EmbeddingGemma worker, up to two decisions closest in meaning (cosine 0.66
  or more, and 0.08 above the median decision). At most five are asked about.
- A stated figure or date that differs from an approved amount or day, with matching
  units and quoted evidence, raises a cue without the model.
- Otherwise the guard's YES/NO question (`live_guard.py`) is scored for each candidate,
  and the strongest confirmation at log-odds 2.0 or more raises a cue. A statement only
  about the past raises none.
- `MEMORIA_LIVE_CHECK=verifier` restores the check of 2 November: a written verdict,
  then the guard.

The meeting window checks each committed caption turn as soon as the speech worker
publishes it (turns are appended, never rewritten), one at a time, oldest first. The
check is on unless switched off, and the choice is remembered. A turn whose check fails
is tried once more. Cues are deduplicated, keep their evidence (value, quote, speaker,
meeting and offset), and at most three are shown. They are review prompts, not
declarations that a speaker lied.

`live_ask` (`live_ask.py`) accepts an explicit question during a meeting. With the
app's Qwen worker it answers from two sources kept apart: the approved value of a
tracked item, read from the ledger, and what was said in this meeting, read from the
live transcript the worker keeps cached and labelled as unreviewed. Otherwise it answers
from approved knowledge only, without the session text: each displayed statement must be
an exact or normalized span of its cited quote, and unsupported paraphrases fail closed.

## Evidence and limits

Live reads reject symlinked storage paths, use valid-now facts rather than future
scheduled claims, and suppress corrected-value cues supported only by inherited
contradictory quotes. Caller-owned live-check jobs are cancelled on disable/unmount.

Original engine files are preserved; integration adapters are new. The research
auditor's MemoriaBench scores do not apply to the app's check, which is measured
separately: `research/memoriabench/APP_LIVE_CHECK.md` (the check of 2 November) and
`research/live-verifier/README.md` (the check of `v0.3.0-uat`), with timings through
the installed app in `research/live-speech/README.md`. Dated real-model and
file-transcription smokes are in `docs/research/`. False-alert rates across many real
meetings, and UAT, are not yet measured.
