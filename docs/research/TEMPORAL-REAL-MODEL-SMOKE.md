# Temporal real-model integration smoke

## Actual result: PASS

One bounded run of the current `src-tauri/resources/memory/temporal_service.py`
completed successfully using the cached local Qwen fallback. Both real model
responses parsed cleanly, both decisions required explicit proposal acceptance,
and temporal queries and ledger invariants returned the expected results.

- Recorded run: **2026-11-01 18:21:43–18:21:53 UTC** (November 2 locally).
- Integration elapsed time, including owned-worker cleanup: **10.494 seconds**.
- Supervisor elapsed time: **10.670 seconds**, exit code **0**.
- Inference process timeout: **300 seconds**; **not reached**.
- Interpreter invoked: `/opt/homebrew/bin/python3.11`; runtime resolved
  `sys.executable` to `/opt/homebrew/opt/python@3.11/bin/python3.11`.
- Environment: `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`,
  `PYTHONDONTWRITEBYTECODE=1`; `MEMORIA_QWEN_SOCKET` unset.
- Model: `mlx-community/Qwen3.5-4B-MLX-4bit`, loaded by the existing
  `model_server.py` through `snapshot_download(..., local_files_only=True)`.
  Cache `refs/main` read after the run:
  `32f3e8ecf65426fc3306969496342d504bfa13f3`.
- Tested adapter SHA-256:
  `95bf037f06f49edd08bfe211a127fdedffe626e25d8a777a04d7c6eb71cd20c6`.

This is a two-fixture integration smoke, not an extraction-quality benchmark or
native/UI verification. No parse or extraction error was observed in this run.
The captured integration stderr is empty. The unmodified fallback worker itself
redirects stderr to `/dev/null`, so worker-internal diagnostics were not captured.

## Isolation and process observations

Scratch root:

```text
/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode/temporal-real-model-smoke
```

The isolated, retained temporary vault is `vault-etb3biao/` under that root
(`/private/var/...` is the filesystem-resolved spelling). The registry, reviewed
transcripts, meeting pages, workspace SQLite database, and temporal ledger all
live there. The only registry write was `temporal_api` → `registry.set` in this
vault, declaring `supplier` / `value` / `text`.

Initial inspection and two further process snapshots five seconds apart found no
concurrent model benchmark or fallback worker. The resident Memoria app Qwen
worker, PID **68357**, parent **66915**, showed **0.0% CPU** in both snapshots.
These are process observations, not a direct GPU utilization measurement.

The existing `local_generator` fallback launched worker PID **74963**, parent
integration PID **74960**, using the current source `model_server.py` and socket
`/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/memoria-501-42444123497a.sock`.
There was no existing fallback socket before launch. Cleanup checked the retained
`Popen` handle plus PID, parent, command, and socket before sending SIGTERM to that
owned worker. It exited with **-15**. Postflight still showed resident app worker
**68357** running; it was not signaled or used for inference.

The harness imports the current modules and invokes
`temporal_api(engine, request)` with **no extractor override**. In-memory observer
wrappers around `build_prompt`, `parse_events`, and `subprocess.Popen` preserve
their actual results and capture prompts, raw output, candidates, and worker
ownership. No generated result or proposal value is substituted. SHA-256 checks
confirmed the five recorded source files were unchanged across the run. No
source, UI, documentation, app registry, or original benchmark output was
edited by this run.

## Reviewed fixtures

Both UUID records were saved through `MeetingService` with status
`transcript-reviewed`, `names={"S01":"Maya"}`, and one turn with speaker `S01`,
start **12.5 seconds**, end **20.0 seconds**. Matching transcript files were
written before saving; the adapter verified the formatted source against the
saved turn and name mapping.

| Decision | Meeting UUID | Created timestamp | Title |
| --- | --- | --- | --- |
| Beta | `8f986af4-5013-4289-aa46-05d39a1449e7` | `2026-10-01T10:00:00Z` | Supplier decision — Beta |
| Acme replaces Beta | `f69e524e-fb2f-42a4-9c65-f9fbbe4b800d` | `2026-10-20T10:00:00Z` | Supplier decision — Acme |

Actual source lines:

```text
[0:12] Maya: We have decided to use Beta as our supplier. This is final.
[0:12] Maya: We have decided to replace Beta with Acme as our supplier. This is final.
```

These are separate transcript files, each containing its corresponding line.
The displayed clock truncates to whole seconds; stored evidence preserves the
actual **12.5-second** start.

## Ingestion and proposal review

| Ingestion | API wall time | Pipeline time | Parsed cleanly | Pending result |
| --- | ---: | ---: | --- | --- |
| Beta, first request including model load | 8.041086 s | 8.03 s | true | proposal 1, Beta, confidence 0.9 |
| Acme, same owned warm worker | 2.177193 s | 2.17 s | true | proposal 2, Acme, confidence 1.0 |

Each ingestion returned `stored_only=false`, `counts={"proposed":1}`, turn **0**,
and an exact full-turn quote. `proposals.list` reported reason `confirm_all`,
speaker **Maya**, and the corresponding fixture UUID. The first pending proposal
had `current_value=null`; the second had `current_value="Beta"`.

Review only selected a unique proposal whose object, attribute, value, meeting,
speaker, and nonempty verbatim quote matched its fixture. Acceptance
used `temporal_api` → `proposals.accept`, reviewer
`authorized-temporal-smoke`, with a review note and no value edits. Proposal 1
became fact 1; proposal 2 became fact 2; both returned `status="in_force"`.

Before accepting Beta, the current query remained **null**. After ingesting Acme
but before accepting it, the current query remained **Beta**, with unchanged
evidence. Final overview contained **zero pending proposals**.

### Raw model responses

Beta:

```json
{"events":[{"turn":0,"quote":"We have decided to use Beta as our supplier. This is final.","object_id":"supplier","attribute":"value","value":"Beta","valid_from":null,"confidence":0.9,"unresolved":false}]}
```

Acme:

```json
{"events":[{"turn":0,"quote":"We have decided to replace Beta with Acme as our supplier. This is final.","object_id":"supplier","attribute":"value","value":"Acme","valid_from":null,"confidence":1.0,"unresolved":false}]}
```

## Actual temporal answers

All queries used object `supplier`, attribute `value`.

| Operation | Actual answer | API wall time |
| --- | --- | ---: |
| `query`, type `current` | **Acme** | 0.007244 s |
| `query`, type `as_of_valid`, `valid_at=2026-10-10` | **Beta** | 0.003185 s |
| `query`, type `n_changes` | **1** | 0.004502 s |
| `check` | `{"ok":true,"problems":[]}` | 0.004192 s |

Current evidence refers to the Acme UUID, Maya, its exact quote, audio start
**12.5**, and extractor `workspace-qwen`. Historical evidence refers to the Beta
UUID with the same preserved speaker/start and its exact quote. `n_changes`
includes both evidence items and both history records: fact 1 is `INITIAL`,
fact 2 is `REVISE`, and fact 2 has `supersedes=1`.

Serialized `decided_at` values are `2026-10-01T10:00:12Z` and
`2026-10-20T10:00:12Z`; the service's ISO serialization displays whole seconds.
History `claim_to` is null on both immutable claims; the current/past queries
nevertheless resolve the revision correctly, and ledger invariants are clean.

All ten harness assertions passed: successful API calls, two clean real replies,
one matching proposal per meeting, unchanged belief before acceptance, current
Acme, historical Beta, one change, preserved current evidence, preserved past
evidence, and clean invariants.

## Retained artifacts and reproduction

Paths below are relative to the scratch root above:

- `smoke.py`: supervisor and integration harness.
- `results.json`: every temporal request/response, API timings, raw replies,
  parsed candidates, saved fixture records, assertions, source hashes, ownership,
  and cleanup result.
- `stdout.jsonl`: actual progress messages and final integration status.
- `stderr.log`: integration stderr, empty for this run.
- `preflight.json`: quiet-period process observations.
- `supervisor.json`: 300-second timeout result and postflight process list.
- `prompt-8f986af4-5013-4289-aa46-05d39a1449e7.txt` and
  `prompt-f69e524e-fb2f-42a4-9c65-f9fbbe4b800d.txt`: actual extractor prompts.
- `vault-etb3biao/`: reviewed fixture transcripts, generated meeting pages, and
  `.memoria-memory/temporal/{registry.json,ledger.sqlite,ledger.jsonl}`.

Actual command:

```sh
/opt/homebrew/bin/python3.11 -B /var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode/temporal-real-model-smoke/smoke.py
```

The supervisor sets offline flags, checks competing processes, then applies a
300-second wait to its integration child. Re-running overwrites scratch capture
files and creates a fresh vault and UUIDs; preserve this run's captures first if
needed. No rerun was needed for the reported result.
