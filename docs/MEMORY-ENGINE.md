# Reviewed local wiki maintenance

## User flow

Import files → review source → Apply source → Build knowledge → inspect claims
and exact supporting quotes → Apply changes or Reject. Review knowledge in the
sidebar restores the durable proposal journal after restart.

The model never writes the workspace directly. Existing text is preserved and
reviewed statements are appended with source links. New typed pages are written
under knowledge/. SCHEMA.md defines rules; index.md and log.md record publication.
This conservative first version does not rewrite summaries or automatically
resolve contradictions. Quote matching proves quote provenance, not entailment.

## Runtime

### Warm generation and retrieval caching

Qwen is retained in a separate private Unix-socket worker for five minutes of
idle time. The socket is user-only (0600), versioned by script/runtime identity,
and has no HTTP endpoint. Generation stops when its requesting socket closes
at the next streamed token; model prefill/loading may finish before it observes
cancellation. The outer request remains cancellable. The worker consumes memory
until idle shutdown; it is not an always-on live-capture service.

Identical embedding inputs reuse a SQLite cache keyed by input content, model
revision and preprocessing script. First retrievals still load embeddings.
Measured temporary one-claim Ask: 17.4s first request, 1.07s and 1.07s repeats.
This is a smoke measurement, not latency guaranteed for larger queries or briefs.

### Job controls (31 October)

Compile, Ask and Brief now receive per-window job IDs, stage events and Cancel
controls. Cancellation terminates the owned Python process group, including its
embedding child, then releases the registry entry. Read-only model work times out
after 120 seconds; publication/review/undo is not user-cancellable and has a
60-second watchdog with existing journal recovery. Semantic retrieval has a
30-second deadline and a concise keyword-fallback warning without command lines
or local paths. Stage labels report source checks, embeddings, language-model
loading and drafting; they cannot directly determine whether an OS permission
dialog is the reason a runtime is stalled. Native cancellation was tested at the
process-group layer, frontend job scoping/cleanup in unit tests. A new native
click-through remains necessary after installation.

The native wiki_memory command validates the requested registered workspace and
runs bundled memory/engine.py using MEMORIA_MEMORY_PYTHON, defaulting to
/opt/homebrew/bin/python3.11. This installation uses its existing mlx-lm runtime
and cached mlx-community/Qwen3.5-4B-MLX-4bit weights. No model downloads occur.

Related-page discovery combines BM25 and EmbeddingGemma 2 through RRF when the
isolated embedding environment is available. MEMORIA_EMBED_PYTHON overrides its
location; this machine's existing ~/Documents/memoria/.runtime/bin/python is
detected as a development fallback. Semantic retrieval failure is shown explicitly
and compilation uses BM25. Models load per compilation; this is not a packaged,
standalone inference runtime or a warm low-latency live service.

Evidence is split into numbered page-aware passages and all passages are processed.
Limits (180k characters / 120 passages / 30k related-page context) fail visibly,
not by silently dropping the end of a source. Entity matching and extraction can
still miss relevant information. Related-page discovery uses bounded excerpts;
this is not a complete chunk-level corpus search implementation or benchmark.

## Persistence

.memoria-memory/journal.sqlite holds pending, rejected, applying and applied
proposals plus before/after publication records. An interprocess lock serialises
memory operations. Source, schema and destination hashes reject stale proposals.
Publication uses atomic file replacements with a durable recovery journal.
Interrupted writes roll back only when bytes still match the attempted write;
external edits stop recovery rather than being overwritten. Normal editor writes
do not take this lock; the current compare-and-replace boundary is not a general
multi-writer filesystem transaction. Raw evidence and attachments are not modified.

## Verification

Four deterministic Python tests cover quote/path validation, preserving user text,
stale-target rejection, idempotent application and interrupted-write recovery.
A real-model smoke test on temporary fictional data successfully used
BM25 + EmbeddingGemma 2, generated a supported launch-date update with Qwen,
preserved the earlier conditional date, and produced schema/index/log files.
This is not a held-out retrieval comparison or final FYP evaluation.

## Review, undo and reuse

### Changed-source gate (31 October 2026)

Ask and Brief now stop before generation when a changed/missing applied source
shares the query topic or a retrieved destination page. The result contains no
answer/citations and identifies sources to rebuild in the AI panel. This prevents
the tested newer-source exclusion from promoting an older launch date to current.
The check is conservative lexical topic matching plus explicit target identity,
not complete semantic supersession tracking; unrelated stale topics remain warnings.
Regression tests cover modified/deleted newer evidence, briefs, and unrelated
stale sources. Source-body hashing and Scout's prior corrections are retained.

Each pending suggestion now has an include checkbox and editable reviewed
statement. Applying first persists those review choices. Quotes and evidence
locations cannot be changed through that editor. Human edits are recorded as
humanEdited, not silently represented as model-verified entailment.

Completed reviews expose Undo. Undo validates all current bytes against the saved
publication receipt before restoring/deleting any file. Newer edits block undo.
An undoing journal state supports recovery after interruption.

The existing AI side panel's Ask / Brief mode queries accepted claims from
applied proposals, retrieves their exact supporting quotes and produces validated
citation-ID output. Changed source hashes are excluded with warnings. Missing
knowledge produces an explicit no-evidence response. Briefs currently render six
sections in-app; standalone HTML export and persistent brief saving are not yet
implemented. Uncited suggested questions are omitted rather than assigned invented
citations. Citation identity validation does not establish semantic correctness.
General chat remains accessible as a separate mode in the same AI panel. Switching
modes retains mounted conversation and knowledge state. The redundant sidebar
Ask/Brief button and dialog were removed; live capture is not connected.

Eight engine tests now cover review edits, undo conflicts and grounded query
eligibility in addition to earlier checks. Real local models passed compile,
apply, cited Ask, six-section Brief and Undo on temporary fictional data.

Pending: standalone model setup, cancellation/timeouts, persistent embedding
cache and full chunk retrieval, health checks, historical query routing, the
controlled retrieval comparison, and native macOS click-through verification.
Desktop input tools in this session are disabled; browser/WebKit integration and
engine tests are not a substitute for native file-picker acceptance.
