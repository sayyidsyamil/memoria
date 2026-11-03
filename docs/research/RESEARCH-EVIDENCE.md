# Research evidence inventory

Reviewed 2 November 2026; results of 3 November are noted where they replace an entry. This inventory records existing evidence and a read-only checksum verification; no model evaluation, native run or UAT was performed for it. Historical scores are not scores of the combined application.

## Path key

Paths were consolidated on 2 November 2026; the original working folders were removed after a
verified backup (`~/Backups/memoria-2026-11-02`). See `research/README.md`.

- `W`: `/Users/sayyid/Documents/memoria-workspace`
- `E`: `W/research/ledger-engine` (formerly `/Users/sayyid/Desktop/FYP/engine`; its `memoria_engine` links to the app's preserved copy)
- `R`: `/Users/sayyid/Documents/Memoria-FYP/report/ap2` (private, not in this repository; formerly `/Users/sayyid/Desktop/FYP/report/ap2`)
- `A`: `W/research/memoriabench` (research files of the separate historical auditor project, formerly `/Users/sayyid/Documents/memoria`)
- `S`: `/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode/overnight-engine-checks` (scratch evidence of the 2 November engine check; `/private/var/folders/...` aliases the same location)

Scratch files are evidence pointers, not durable thesis attachments; archive them before relying on them for the final submission.

## Historical temporal evaluation

| Evidence | Result or purpose | Scope and caveat |
|---|---|---|
| `E/results/ami/ami_test_report.md`, `memoria_test.json`, `baselines_test.json` | Immediate temporal ingestion: 59/96 (61%, Wilson 95% interval 52–71%); full context 41/96; BM25 37/96 | Five unseen AMI teams, 20 meetings, Qwen3.5-4B 4-bit, October run. Current-value accuracy 18/34 was below both baselines numerically. Exploratory paired tests, no multiplicity correction. |
| `E/results/ami/ami_test_review_report.md`, `memoria_test_review.json` | Oracle review: 85/96 (89%, interval 81–94%); current 29/34; past-date 29/29; changes 27/33 | Scripted gold-aware reviewer, not UAT. First-value errors remained. Do not label 85/96 an oracle-extractor result. |
| `E/results/ami/ami_test_report.md` oracle rows | Oracle extractor plus model router: 96/96; exact routes 81/96 | Observed answer errors were attributable to extraction on this set. Fifteen route mismatches were masked by empty past-date answers. |
| `E/results/ami/review_burden_test.json` | 35 proposals: 22 rejected, 8 accepted, 5 edited/accepted; 112 candidates applied directly | Historical conflict-only review policy; current `confirm_all` changes burden. No observed human review time. |
| `E/data/ami_v0/`, `E/results/ami/gold_*.md`, `E/scripts/ami/specs.py` | Derived meeting chains, registry, gold and questions | AI-assisted derivation from human abstracts; template questions, incomplete gold, assigned weekly study dates. AMI is role-played natural speech, not organisational deployment data. |
| `R/ch03_methodology.md` §3.4; `E/results/ami/ami_test_report.md` | 29/29 past-date gold answers are empty; 29/33 change counts are zero; four true changes, two matched replacement links | Stronger support for preventing future leakage than for real supersession retrieval. Gold-event totals in Chapter 3 (18 dev/41 test) differ from the later result setup (23/46); reconcile generator/result definitions before merging tables. |
| `E/results/test/scaling_report.txt`, `E/results/demo/` | Controlled synthetic scaling and fictional service runs | Synthetic padding and scripted review. Historical text/audio service scores are not current workspace integration scores. |

The thesis-ready interpretation is that the temporal representation helped on the tested question distribution, while extraction limited answer accuracy. Gold/oracle consistency is not independent annotation validation, and incomplete gold does not make every extra extraction harmless.

## Separate historical auditor and guard

| Evidence | Result or purpose | Scope and caveat |
|---|---|---|
| `A/results/table_6_1.csv`, `A/results/predictions_raw.jsonl`, `A/results/run_meta.json` | M2 six-class auditor: accuracy 0.8720; macro-F1 0.8713 (cluster-bootstrap interval 0.8357–0.9044); alert TP/FP/FN/TN = 110/1/2/223 | 336 generated probes, 28 series. Curated approved decision memory, not extracted workspace memory. Report as macro-F1 **0.87**, not 87% end-to-end accuracy. |
| `A/data/memoria_bench.jsonl`, `memoria_bench.provenance.jsonl`, `A/generate_bench.py` | Six balanced classes; 112 alerts and 224 non-alerts | Only 5/56 OUTDATED examples are real recorded replacements; 51/56 rely on synthetic replacement notes. Meeting d held out from memory construction. |
| `A/data/memoria_bench.audit.json` | Blind model label audits: round 1 334/336; revised round 2 336/336; final changed subset 24/24 | Both labellers were language models and saw replacement notes. Labels were revised between rounds; this is not independent human agreement or a final-file 336-row round-3 audit. |
| `A/results/memoria_as_run.py`, `MEMORIA_PY_AS_RUN.txt`, `results_manifest.sha256` | As-run auditor and result provenance | Citation parsing was fixed later. Preserve the as-run version when discussing original results; benchmark label accuracy differs from citation correctness. |
| `A/results/scoping/scoping_results.json`, `scoping_table.csv`, `bakeoff/bakeoff_results.json` | Growing-memory/scoping and retrieval experiments | Scoped retrieval lost relevant facts; no retriever met the specified recall-safe threshold. Filtered distractors and shared remote-control topics limit generalisation. |
| `A/GUARD.md`, `A/guard.py` | Historical relevance, YES/NO log-odds confirmation and citation reassignment | `MIN_SCORE=1.0` selected after seeing both evaluation halves among 0/1/2: guard results are optimistic. Same model provides confirmation, not an independent verifier. |
| `A/GUARD.md` guard results | Benchmark alerts: raw auditor 110/112, guard 107/112; one false alarm out of 224 in each; correct citations 101 versus 102 | Guard trades recall for screening. Historical caption negative controls and look-alikes are separate samples; do not transfer their false-alarm rates to current provisional ASR or infer alerts per real meeting hour. |
| `A/GUARD.md` extraction-filter section | Separate extraction confirmation threshold `MIN_CONFIRM=-4.0`; developer-labelled proposal samples | This threshold is documented as selected on a development sample and retained on test, unlike the alert threshold. Single labeller, small samples, includes unsettled proposals. |
| `R/ch06_memoriabench_draft.md`, `A/results/chapter6_memoriabench_draft.md` | Draft report narrative for the auditor extension | Draft is outside the main report build. Keep it as an extension unless objectives and research questions are formally revised. Point estimates on the five-series subset still have sampling uncertainty. |

The recorded warm per-probe times in the auditor files exclude the current speech, scheduling, transport and review chain. They are not live latency of `W`. No new auditor or guard run was made here.

## Deterministic verification and reproducibility correction

`S/SUMMARY.md` records `python3.11 -B -m unittest discover -s tests`, working directory `E`: **291 discovered, 291 run, 291 passed**, no failures, errors, skips, expected failures or unexpected successes; exit 0; **4.319 seconds of unittest time**. No model runtime modules loaded. `S/test-result.json` lists exact test IDs; `S/run.json` records the command, environment and UTC start. `S/unittest.stderr.txt` holds the unittest output. The summary retains the first instrumentation attempt separately; use the successful result, not that failed harness attempt.

`S/engine-before.json` and `S/engine-after.json` support preservation across 6,266 original engine files, excluding the virtual environment: SHA-256, size and modification time unchanged. This verifies that the test run did not alter those files. It does not mean that current sources equal October's pre-evaluation freeze. The old `E/results/testing/summary.json` records 271 tests and 7.69 seconds wall time; it is an older snapshot. Its 164/88/19 level counts and historical coverage cannot be reassigned to the 291-test run.

A read-only command in `E`, `shasum -a 256 -c results/ami/frozen_manifest.sha256`, checked 37 entries. All **14 data entries** matched. Four code entries failed: `memoria_engine/extractors.py`, `memoria_engine/ledger.py`, `memoria_engine/llmcache.py`, `memoria_engine/pipeline.py`. The other 19 code/script entries matched. "All 37 still match" therefore holds for the frozen run, not for the present tree. The report's stable logged experiment hash is historical run evidence, not the present working-tree hash.

`E/results/testing/defect_log.md` records four offline AMI replays identical to saved results, using `E/scripts/ami/replay_offline.py`. `E/results/testing/evidence/oracles_before_after.txt` records additional cached replay/policy/parser equivalence checks. These are existing records, not new replays. Cache replay tests effects on recorded replies; it does not establish equality of new model outputs under a changed runtime.

A snapshot of **37 new Python integration checks** was reported during development; no durable log of it was found and it was not rerun, so it is not added to the 291. The app's Python suite has its own count: 214 tests on 3 November ([WORKSPACE-PRODUCT-VERIFICATION.md](../WORKSPACE-PRODUCT-VERIFICATION.md)). For the wiki, meeting, temporal and live-check integration modules alone, use this deterministic command from `W/src-tauri/resources/memory/`:

```sh
python3.11 -B -m unittest test_engine test_workspace_product test_temporal_service test_live_assistance
```

Cite the module set and resulting count for each run. Test fixtures inject generators/verifiers and use temporary workspaces; they do not measure model accuracy, live latency or user acceptance.

## Current implementation evidence

| Path under `W` | What the inspected implementation supports | What it does not establish |
|---|---|---|
| `src-tauri/resources/memory/temporal_service.py`, `test_temporal_service.py` | Workspace-scoped ledger; saved-turn consistency; meeting date/offset/speaker preservation; reviewed first values; current/past/change-count evidence; long meetings read through the evaluated `WindowedExtractor` (M2: ten windows over a 60-minute AMI meeting, three proposals with evidence at 32:07 and 41:30, `research/long-meeting/`) | Actual meeting-date truth, extraction recall on long meetings beyond that one check, current benchmark score. |
| `src-tauri/resources/memory/memoria_engine/` | Preserved engine implementation and four deterministic lookups | That the entire integrated path is identical to the historical evaluated runtime. |
| `src/features/temporal/temporalService.ts`, `TemporalMemoryPanel.tsx`, their tests | Typed native envelope, proposals, correction/retraction, evidence/history and selected temporal queries | Proposal editing before acceptance, complete registry setup/sample, batch import, temporal brief. Since M2 the panel offers only kinds the ledger accepts and holds back type edits that would strand recorded values; current-value, date and change questions in Ask are answered from approved facts (`ask_facts.py`). |
| `src-tauri/src/commands/temporal.rs`, `commands/wiki_memory.rs` | Tauri transport through workspace memory runtime | A newly accepted native release, clean installation or end-to-end performance. |
| `src-tauri/resources/memory/live_assistance.py`, `test_live_assistance.py` | Read-only current-fact snapshot; no pending/history rows; qualified exact numeric checks; strict selected-fact JSON verification; the evaluated guard (YES/NO confirmation and attribution, `live_guard.py`); inspectable cues; malformed/late verifier handling. Binary MemoriaBench test result through the installed app's worker (M2, 2 November): recall 81.3% (75.0–87.5), false alarms 1.3% (0–3.1), `research/memoriabench/results/app_live_check/`. The check of `v0.3.0-uat` (3 November; the guard alone, candidates also by meaning): 98/112 caught (87.5%), 2/224 false alarms (0.9%), 0.26 s median, and no alert on the unrelated AMI hour (`research/live-verifier/`) | Six-class equivalence with the historical M2 auditor (the app emits alert/no-alert only); false-alert rates beyond that one unrelated hour; user-written registries instead of the harness's one slot per decision. SQLite WAL readers may create coordination sidecars despite durable files remaining unchanged in the tested checks. |
| `src/components/MeetingHud.tsx`, `MeetingHudView.tsx`, `src/features/temporal/liveAssistanceService.ts` | Assistance on unless switched off (it was off by default on 2 November); each committed turn checked once published; bounded cue display; provisional-label notice; audio chunk persistence. Capture-to-cue timings through the installed app (3 November): `research/live-speech/` | Full backend warning display, automatic approved-memory ingestion. The current recorder writes audio, unlike the old report's no-audio-file design. |
| `src-tauri/resources/memory/engine.py`, `test_engine.py`, `test_workspace_product.py`, `meetings_service.py` | Reviewed wiki publication, source-hash gates, undo/conflict handling, durable meeting records and cited saved briefs | Automatic equivalence between wiki claims and temporal facts; full semantic supersession in wiki prose. |
| `docs/MEMORY-ENGINE.md`, `docs/notes/ENGINEERING-LOOP-2026-11-01.md`, `docs/MODEL-LIFECYCLE.md` | Existing design and isolated engineering observations | Some older prose was stale as code evolved (for example, the memory guide said brief saving was pending while tests covered saved briefs; updated on 3 November). No combined acceptance follows from readiness/speech smoke tests. |

Keep four states explicit: **source evidence → reviewed compiled wiki** is one publication path; **reviewed transcript → proposed temporal claim → human-approved temporal fact** is another. **Provisional speech → read-only check** changes neither. A wiki source-change gate does not automatically invalidate or retract an already approved temporal fact; current re-review/source-revision lifecycle is not demonstrated as a unified mechanism.

## Speech, UAT and literature inventory

`E/results/asr/README.md` and `app_path_check.md` document historical post-recording Parakeet/Sortformer evaluation: pooled WER 19.9%, DER 28.4% on six near-field AMI meetings, and a separate application-path check. These results do not evaluate the later speech paths. MOSS file transcription was measured once at full length in M2 (2 November): 60:00 of AMI ES2004b–c in 11.6 minutes, WER 13.2% (fillers removed, research normalisation), four participants on four labels (`research/long-meeting/`). Since 3 November the app uses Parakeet Ultra with Nemotron 3 Diarization: on the same hour, WER 14.4%, 97.4% of labelled words on the right participant, 113 s; as live captions, WER 15.2% (`research/live-speech/`). `S/audio-inventory.json` inventories 20 existing AMI WAVs and three synthetic demo WAVs. `S/SUMMARY.md` proposes an IS1009a 30–90 second interval; it was not extracted or benchmarked. Annotation ZIPs contain no audio, and demo speech is macOS text-to-speech, not natural AMI speech.

`R/ch06_results_discussion.md` §6.5 and `/Users/sayyid/Documents/Memoria-FYP/report/uat/` (private) provide a planned protocol, not completed participant results. Historical installation evidence in `E/results/testing/install_smoke.md` still leaves clean-account first-run T1 pending. AC1–AC5, SUS, current AC7 and integrated consent acceptance must remain unverified until observations and receipts exist.

`/Users/sayyid/Documents/Memoria-FYP/research/benchmarks_report.txt` (private), `datasets_report.txt` and `uat_report.txt` are earlier research/scoping notes. `R/ch02_literature_review.md` and `references.md` supply the thesis literature context. Benchmark suggestions, setup estimates and vendor-reported external scores in those notes are not Memoria experiment results, and were not freshly web-verified here. LongMemEval and other memory systems were not run for this supplement. Do not claim superiority to systems absent from the same-model comparison.

## Evidence still needed

For a combined-integration result, retain an immutable source/runtime manifest, dataset/provenance hashes, reviewed gold labels, exact commands and raw predictions. Measure the actual capture-to-cue path separately from warm verifier compute, including permissions, load, turn completion, scheduling and failed/quiet checks (first timings through the installed app, 3 November: `research/live-speech/`). Evaluate retrieval misses, valid historical mentions, units/caps, false cues and citation correctness on provisional transcripts as well as clean text. Complete the planned unaided tasks/SUS and clean-account release checks. These are outstanding evidence needs, not experiments performed or scores claimed by this inventory.
