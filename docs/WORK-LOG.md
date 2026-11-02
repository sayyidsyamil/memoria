# Memoria implementation work log

Entries distinguish plans, attempts, verified results, and blockers. Times are UTC.
No historical benchmark score is attributed to a new integration without evaluation.

## 2026-11-01T17:27:30Z — Started

- Mode: Build. User authorized implementation, public-data testing, model comparison,
  native/browser automation, subagent delegation, and publishing verified milestones.
- Product direction: one GitHub Memoria workspace combining document editing,
  maintained knowledge, temporal decisions, and quiet live assistance.
- Scope: product, research, and concise report updates; PowerPoint handled separately
  by the user through Microsoft Scout. No paid third-party services authorized.
- Baseline: `6c58d478`; working tree clean. Approximately 18 GiB available.
- Preserve: other Dock app at `~/Documents/memoria`, original FYP engine/report,
  historical datasets/predictions and personal vaults. Use disposable fixtures.
- Plan: preserve evaluated engine → typed temporal API → reviewed facts UI → live
  assistance integration → public-data evaluation → report and wake-up handover.
- Limitation: eight hours is the intended work window, not a guaranteed runtime.

## Temporal integration milestone — verified during this run

- Preserved 22 original engine Python files under `src-tauri/resources/memory/memoria_engine`.
- Added workspace-scoped temporal service and Tauri API, explicit reviewed-meeting
  ingestion, and frontend tracked-facts setup/review/history/correction/query panel.
- Deterministic two-meeting fixture verified initial review, revision approval,
  current/past answers, one change, and exact saved audio offset/speaker provenance.
- Python combined checks: 37 passed at this milestone. Frontend temporal + meeting
  integration: 44 passed. These are development checks, not evaluation/UAT scores.
- Delegated read-only original engine check: 291 tests passed in 4.319 s; preservation
  manifests confirmed no source/result modifications. Evidence is in scratch
  `overnight-engine-checks/`. An initial scratch-instrumentation failure is retained
  there and excluded from the final successful-run count.
- Research audit: four engine code files differ from the historical freeze; all
  listed AMI dataset files match. Auditor result-manifest entries match. Old
  evaluations are not attributed to the combined application.
- Added opt-in live evidence adapter and HUD cues; native/end-to-end live latency
  remains unverified. Adapter deterministic tests were delegated and passed.
- Report supplement and evidence inventory drafted under `docs/research/`; original
  thesis/report preserved, UAT and supervisor approvals explicitly pending.

## Native packaging and real-model verification

- Native Tracked facts initially failed: nested `memoria_engine.evaluation` files
  were flattened by the wildcard resource map. Corrected mapping to preserve the
  directory; packaged import test passed and rebuilt/reinstalled app loaded the
  setup panel successfully. Screenshots: scratch `temporal-native.png` (failure),
  `temporal-native-fixed.png` (successful setup view).
- Explicit live Ask added to Record view. Session text is bounded provisional
  context; eligible approved knowledge remains the only answer citation source.
- Public AMI smoke: IS1009a interval 30–90 s, 14 segments, wall 17.651 s, file RTF
  0.294. No WER or live latency claim; annotations show speaker/word differences.
- Real Qwen temporal smoke: 10.494 s, clean Beta/Acme proposals; reviewed approval,
  current Acme, historical Beta, one change, exact quotes/Maya/UUIDs/12.5 s offset,
  invariant check passed. Separate scratch vault; historical results untouched.
- Current focused frontend integration run: 64 passed across seven files. Live
  Ask UI and temporal panel tests are included; full app/native live flow remains
  outstanding. Adapter/backend combined suite previously passed 58 tests before
  live Ask addition; final count recorded after the next run.

- Packaging defect corrected and installed panel now renders tracked-item setup
  without import errors. Native capture does not establish complete CRUD acceptance.
- Original FYP benchmark data stays outside publication; only preserved engine code
  and provenance notes are included. Report supplement does not alter the original
  thesis or claim participant testing.

## Integration defect review and hardening

- Review confirmed concrete failures using disposable fixtures: extraction failure
  consumed meeting ID; storage symlinks escaped scope; future-effective open-ended
  facts entered live checks; corrections retained unsupported quotes; session text
  could influence a factual answer with a valid but unrelated citation.
- Fixes: pre-extract candidates before vendor source insertion; reject storage
  symlinks; valid-now fact selection; correction provenance/suppression; strict
  method/ID/date/enum validation; realistic history fields and integer IDs in UI.
- Live Ask now excludes session text from generation and requires exact/normalized
  quote support for displayed factual statements. Session-only answers remain
  unsupported, explicitly documented. No prompt warning is treated as proof of
  grounding.
- Live statement reads no longer construct/write Engine or hold publication lock
  through inference. Caller-owned check IDs cancel on disable/unmount; bounded
  retries and no-data notices added. Final-turn completion still needs a reliable
  upstream signal.
- Adapter focused Python suite after hardening: 40 passed. Frontend contract and
  temporal panel corrections: 26 passed. Final comprehensive run follows below.

## 2026-11-01T18:41:04Z — Hardened build milestone

- Comprehensive Python adapter/engine/product suite: 76 passed.
- Focused frontend temporal/meeting suite: 67 passed across seven files.
- TypeScript/scoped ESLint and native app bundle pass; packaged temporal adapters
  and nested engine import verified. Original 22 engine Python files unchanged.
- Preferred black/white Dock logo copied from original app artwork; generated
  native icon sizes. Both dynamic light/dark 512px icons use the preferred artwork.
- Real Qwen temporal smoke remains an isolated integration result, not a benchmark.
- Approximately 74 minutes of work completed at this checkpoint; not eight hours.
  Remaining: native hardened install/flows, live latency/queue tests, reproducible
  runtime setup, wider report reconciliation and end-to-end evaluation.

## 2026-11-01T19:00Z — Streaming diagnosis and timing contract

- Reviewed the preserved model-only streaming smoke: 240/240 sequential ACKs,
  15 final segments, no errors/gaps. Six initial empty windows explain part of the
  +31.451s first-readable-caption time; it is not solely processing latency.
- Fixed trimmed-text/source-interval ambiguity with preserved raw interval and
  explicit unresolved timing metadata, visible review/export labels, and temporal
  ingestion refusal before inference. Refinement remains available for these drafts.
- Removed empty caption events while preserving ACKs and error/gap reporting.
- Sequential same-fixture experiments: 2s core first caption +28.926s, maximum ACK
  2.111s, End drain 1.899s; patched 4s +31.424s, ACK 1.422s, drain 1.037s.
  Retained the 4s default because the single 2s experiment increased backpressure.
  Both completed 240/240 ACKs with no errors/gaps; original data/scratch unchanged.
- Checks: 77 backend adapter/product tests; 20 speech/temporal/meeting focused tests
  (overlapping coverage); 68 frontend tests. TypeScript and scoped lint passed.
  Initial Python invocation from repo root failed module discovery; corrected with
  explicit backend PYTHONPATH. This was a command error, not passing test evidence.
- Evidence: research/PUBLIC-STREAMING-SMOKE.md and PUBLIC-STREAMING-CADENCE.md.
  Native capture/queue/final-turn behaviour and latest installed build remain to verify.
- Follow-up build: TypeScript, Vite production build, scoped lint and diff whitespace
  check passed. Tauri debug app bundle built (103.81 MiB); packaged live adapter
  equals source byte-for-byte and nested engine/temporal imports passed. Not reinstalled
  at that checkpoint; installed during the native check below.

## 2026-11-02T00:23:55Z — Installed native temporal acceptance check

- Installed latest verified bundle with graceful quit/relaunch; native footer runtimes
  Ready. Used disposable fictional reviewed evidence and a labelled silent audio fixture.
- Native setup, Qwen suggestions, explicit Beta/Acme approvals, current Acme, past Beta
  on October 10, one change, Maya/UUID/12.5s evidence and restart persistence passed.
- Original no-audio fixture could not open meeting review; added silent attachment
  using packaged service. Fixture words are manually prepared, not speech output.
- Observed UX follow-ups: raw JSON query results, “1 changes”, machine dates/UUID labels.
- Native Live Ask, recording/End/final-turn, queue/crash recovery still unverified.
  Detailed scope/evidence in research/NATIVE-INTEGRATED-CHECK.md.
