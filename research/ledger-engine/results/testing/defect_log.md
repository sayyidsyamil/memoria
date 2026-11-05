# Defect log: Memoria engine

Found by the failure-injection tests in `tests/test_error_handling.py` (70 tests, IDs `TC-ERR-01` to `TC-ERR-70`).
Nothing was hidden: every defect below is reproduced by a test that asserts the *correct* behaviour.

## 1. Status in one paragraph

15 defects (DEF-01 to DEF-15) were found by the failure-injection tests, plus 4 documented limitations (DEF-L1 to DEF-L4, section 4). Six more
gaps (DEF-16 to DEF-21) were found afterwards while testing the recording wrapper, the application's service and the packaged release. **All 21 are fixed in the live
`memoria_engine/` as of 14 Oct 2026.** The fixes were held back until the evaluation had finished, because the evaluation records the hashes of the
engine files (`results/ami/frozen_manifest.sha256`, code and data hash `70ce8922420a` at every step of the test-split run). They were written and verified
on a scratch copy first (`proposed_fixes.patch` for DEF-01 to DEF-15) and then copied into the live tree.

* Before the fixes: 217 tests, 200 pass + 17 expected failures (the tests that reproduce the defects), 0 failures (`prefix_run.txt`).
* After the fixes: 245 tests (the 70 failure-injection tests, 16 for the windowed extractor, 7 for the recording wrapper, 4 service tests of the gaps and the earlier suites), **all pass, no expected failures**; the `@known_defect` markers are removed.
* The fixes do not change any recorded evaluation result: the four finished AMI runs (test split: Memoria, baselines, Memoria with an oracle reviewer; dev split: Memoria) were replayed offline, from their call caches and without a model, on the fixed code with `scripts/ami/replay_offline.py`, and **all four replays are identical** to the stored results in answers, scores, extraction and ledger.
* `@known_defect("DEF-nn")` was a thin wrapper over `unittest.expectedFailure`; when a fix worked the test turned into an "unexpected success", the signal to delete the marker.

Severity: **High** = silently wrong data, or the ledger cannot be opened again; **Medium** = an ingest aborts, is half applied or
silently drops events; **Low** = misuse of the API or a weaker audit trail.

## 2. Defects

| ID | Sev. | Defect and observed behaviour | How found | Status | Fix in the patch |
|---|---|---|---|---|---|
| DEF-01 | Medium | `parse_events` raises on replies that are valid JSON but of an unexpected shape: `{"events": null}`, `5`, `true` (TypeError), a 50,000-deep nesting (RecursionError), a 5,000-digit integer (ValueError). One such reply aborts the whole `ingest`; 803 of 42,000 fuzzed replies raised `TypeError`, and 142 of 3,300 fuzzed pipeline runs aborted the same way. | TC-ERR-09, 12, 13; fuzz layers 1 and 2 | Fixed 14 Oct | clean only if the reply is a dict with an `events` list; catches ValueError, TypeError, RecursionError |
| DEF-02 | Medium | A reply that forgets the `events` wrapper (a lone event `{"quote": ...}`, `{}`, `{"events": "none"}`, `{"events": {...}}`, a top-level array) returns `([], parsed_cleanly=True)`: events are lost silently and the caller is told the reply was fine. | TC-ERR-09 | Fixed 14 Oct | such replies go through the salvage path (a lone event is recovered) and are flagged `parsed_cleanly=False`; `{"events": []}` stays clean |
| DEF-03 | Medium | `"unresolved": "false"` (also `"no"`, `"0"`, `"False"`) is read as True, so a decision the model marked as settled is dropped as unresolved. | TC-ERR-08 | Fixed 14 Oct | `_flag()` reads `""`, `false`, `no`, `0` as False |
| DEF-04 | High | `Registry.normalise` for numbers accepts `[1, 2]` as 12 and `{"a": 2}` as 2 (digits are scraped from the text of the object: silently wrong values with real evidence attached); accepts `inf` and a 400-digit string as infinity (the ledger later refuses it and the ingest aborts); `10**400` raises `OverflowError`. | TC-ERR-18; fuzz layer 2 (2 aborts) | Fixed 14 Oct | only int, float and str accepted, result must be finite (`OverflowError` becomes `ValueError`) |
| DEF-05 | Medium | A confidence that is not a number in [0, 1] (95, -0.2, NaN, infinity, a huge integer) reaches the ledger unchanged: `sqlite3.IntegrityError` (CHECK constraint) or `OverflowError` aborts the ingest (35 IntegrityErrors and 10 OverflowErrors in 3,300 fuzzed pipeline runs). A boolean is stored as 1 or 0. | TC-ERR-32, 70; fuzz layer 2 | Fixed 14 Oct | `_confidence()` keeps real numbers in [0, 1]; anything else is stored as NULL ("not sure") |
| DEF-06 | Medium | Valid but non-canonical dates are stored as written: `"20260301"`, the integer `20260301` and `"2026-W10-1"` (Python 3.11 accepts them) become different values from `"2026-03-01"`, so one deadline can appear as a spurious revision. | TC-ERR-16 | Fixed 14 Oct | dates are stored as `date.fromisoformat(...).isoformat()` (in the value and in `valid_from`) |
| DEF-07 | Medium | The fuzzy path of `ground()` returns `Turn.index` instead of the turn's position. With 1-based, gapped or offset indexes it cites the wrong turn (so the wrong speaker and time) or raises `IndexError`. Latent: the shipped loaders number turns from 0. | TC-ERR-28 | Fixed 14 Oct | the fuzzy path returns the position in `meeting.turns` |
| DEF-08 | Low | A `Turn.start` of NaN or infinity raises (`ValueError`/`OverflowError`) only after the source row is written and the extractor has been called. | TC-ERR-35 | Fixed 14 Oct | `ingest` checks every `Turn.start` first and raises `ValueError` before any write |
| DEF-09 | Medium | There is no isolation per candidate: if the ledger refuses one candidate (for example `InvalidAssertion` or `IntegrityError`), the exception leaves `ingest` and the candidates written before it stay: a half-ingested meeting (23 of 3,300 fuzzed runs). | TC-ERR-33, 70; fuzz layer 2 | Fixed 14 Oct | a refused write becomes disposition `invalid` with reason "ledger rejected the write: ..."; the other candidates continue. Reviewer exceptions still propagate (TC-ERR-44) |
| DEF-10 | Low | `make_policy("threshold:nan")` is accepted; every comparison with NaN is false, so no candidate is ever sent to review. | TC-ERR-43 | Fixed 14 Oct | NaN threshold raises `ValueError` |
| DEF-11 | High | If the text of a meeting contains U+2028, U+2029 or U+0085 (these characters can come with text pasted from Word, PDFs or web pages), the event log can no longer be read: `str.splitlines()` cuts the JSON record in the middle and the next `Ledger(...)` raises `LogCorrupt`. The ledger is unusable until the log is repaired by hand. | TC-ERR-60 | Fixed 14 Oct | `_read_log` splits records on `"\n"` only |
| DEF-12 | Medium | A damaged log does not always raise `LogCorrupt`: of 10 damaged variants, 0 raised it (`AttributeError` x4, `UnicodeDecodeError`, `KeyError` x2, `TypeError`, `UnknownReference`, `InvalidAssertion`). The bytes are never modified (the test checks this), but the caller cannot tell "corrupt log" from a program error. | TC-ERR-59 | Fixed 14 Oct | non-UTF-8 bytes, non-object records and failed replays are wrapped in `LogCorrupt` |
| DEF-13 | High | A failed log append leaves residue: when `fsync` reports EIO or the disk fills up halfway through a record, the orphan or partial line stays in the log, so the next write gets a conflicting sequence number and the next restart fails (`LogCorrupt`, `JSONDecodeError`); a failure of `COMMIT` leaves the connection in a transaction ("cannot start a transaction within a transaction"). | TC-ERR-61 | Fixed 14 Oct | `_txn` commits inside its try block; on any failure the log is truncated back to its size before the record and the transaction is rolled back |
| DEF-14 | Low | Direct ledger calls accept validity bounds that are not integers (`"2026-01-01"`, `1500.5`, `True`): of 12 calls, 8 were accepted, 3 raised a raw `TypeError` and 1 was refused with `InvalidAssertion`; in one case an accepted bound left the slot unwritable. | TC-ERR-55 | Fixed 14 Oct | bounds must be None or an int (not bool) inside the 64-bit range, else `InvalidAssertion` |
| DEF-15 | Low | `correct()` accepts an empty, blank or None reason, so the audit trail can say nothing about why a fact was corrected. | TC-ERR-54 | Fixed 14 Oct | reason must be a non-empty string |
| DEF-16 | Medium | The recording wrapper (`llmcache.py`) cannot read its cache file again if a crash left a half-written last line (`JSONDecodeError` at start), and the next append would be glued to that line. A long evaluation could not be resumed without editing the file by hand. | `tests/test_llmcache.py` (found while writing the tests for the wrapper) | Fixed 14 Oct | a line that cannot be read is skipped and counted (`skipped_lines`), the call is simply made again, and a missing final newline is repaired before the next append |
| DEF-17 | Medium | The service accepted the same `meeting_id` twice and stored it again (only the app's screen prevented it). | `tests/test_service_hardening.py` (SVC-01) | Fixed 14 Oct | `meetings.ingest` refuses an id that is already in the ledger with `AlreadyDone` |
| DEF-18 | Medium | `facts.correct` and `proposals.accept` with an edited value stored the raw value: a person given by display name ("Wei Ling") was stored as text instead of the person id (`wei_ling`), so it did not equal the extracted value. | SVC-02 | Fixed 14 Oct | the value is normalised with the tracked item's own rules before it is written |
| DEF-19 | Low | `facts.correct` accepted a free-text date ("soon-ish") that the extractor path would have refused. | SVC-03 | Fixed 14 Oct | the same normalisation refuses it with a readable error |
| DEF-20 | Low | `facts.history` did not say who corrected a fact and why (the reason sat only on the retracted old fact). | SVC-04 | Fixed 14 Oct | the new value carries `correction: {reviewer, reason, replaced_fact_id}` |
| DEF-21 | High | **Packaging (found by installing the built .dmg and running the doctor against the bundled engine).** Tauri copies a resource folder given as a glob (`dir/**/*`) flat: the packaged engine lost its `memoria_engine/evaluation/` sub-package and could not start (`ModuleNotFoundError`), and the offline starter vault lost its `views/` folder (the template marker of the starter check). Unit tests and the dev build used the source tree, so nothing failed before the release was installed. | release build 1, doctor on the bundled engine | Fixed 14 Oct | resources are declared as plain directories; `scripts/build-release.sh` now fails the build if `engine/memoria_engine/evaluation/router.py` or `demo-vault/views/active-projects.yml` is missing from the bundle, and imports the bundled engine before it finishes |

Minor observations, not fixed and not covered by a failing test: the message for an unknown entity reads `unknown entitie: ...`
(`ledger.py`, `_require`, cosmetic); a `log_path` in a directory that does not exist is only noticed at the first write, which raises
`FileNotFoundError` (the database is rolled back).

## 3. Evidence that the fixes are safe

* The patch applies cleanly to a pristine copy of the live tree (`patch -p1 --dry-run`, and `git apply --check` on the live tree, which
  was not modified).
* Patched copy, all tests: 217 pass, 0 expected failures (`after_fix_run.txt`; the generated table is in `after_fixes/`).
* Behaviour on recorded evaluation data does not change (details and commands in `evidence/oracles_before_after.txt`): the offline
  replay of the recorded evaluation (test K = 0, 8, 24, 48; dev K = 0, 8; 0 cache misses) gives byte-identical output; the replay of the stored raw replies through all review
  policies (13 + 51 entries) gives byte-identical ledgers and answers; for 478 recorded extraction replies `parse_events` returns identical
  candidates and the same clean flag. The only observable change is the clean flag of 452 non-extraction replies (question router and
  baseline answers that are valid JSON without an `events` list): `True` becomes `False`, candidates unchanged. `parsed_cleanly` is
  read only by `MLXExtractor.extract` (a statistic) and by `windowed.py`.
* Seeded fuzz campaign (`evidence/fuzz_campaign.py`, seed 20260301): 42,000 mutated replies into `parse_events` and 3,300 mutated
  pipeline runs (11 recorded meetings x 300 mutations x 3 policies).

  | | before (live) | after (patched copy) |
  |---|---|---|
  | exceptions from `parse_events` | 803 | 0 |
  | pipeline runs that raised | 189 (TypeError 142, IntegrityError 35, OverflowError 10, InvalidAssertion 2) | 0 |
  | meetings left half ingested | 23 | 0 |
  | ledger invariant violations | 0 | 0 |
  | stored facts whose evidence does not match the transcript | 0 | 0 |

  The core guarantees (append-only history, supersession, evidence cited from the transcript) already held under garbage input; the
  defects are in the error edges around them.
* Line coverage of the core engine is 96.8% on the live tree and 96.2% with the patch (`coverage.txt`, `after_fixes/coverage.txt`).
  The new defensive lines not run by any test are: the `OSError` guard in `_unwind_log` and the re-raise of `LogCorrupt` during replay
  (`ledger.py`), the non-numeric `Turn.start` guard and the refused-`propose()` branch (`pipeline.py`).

## 4. Documented limitations (characterisation tests, behaviour kept, no fix proposed)

| ID | Test | Behaviour |
|---|---|---|
| DEF-L1 | TC-ERR-21 | Numeric salvage keeps the digits and drops the unit or scale: `"2.5 million"` and `"RM2.5 juta"` give 2.5, `"1,5"` gives 15. The prompt asks for plain numbers. |
| DEF-L2 | TC-ERR-29 | `ground()` refuses a short quote that still carries the `"[1] chair:"` header (fails closed instead of guessing). The prompt tells the model to quote the words only. |
| DEF-L3 | TC-ERR-40 | The same transcript text submitted under a different meeting id or date is refused with `InvalidAssertion` (sources are keyed by content hash). The ledger is unchanged. |
| DEF-L4 | TC-ERR-64 | The log has no checksum: a hand edit that keeps the JSON valid and the sequence numbers intact is accepted on rebuild. Only accidental damage is detected. |

## 5. Riskiest behaviours probed that behaved correctly

| Risk | Tests | Result |
|---|---|---|
| Garbage model output: empty, prose, truncated, fenced, text around the JSON, reasoning with braces, missing fields, wrong types, Infinity and NaN, Unicode | TC-ERR-01 to 07, 10, 11, 30, 31 | no exception; valid events are kept, invalid ones get a status and a reason |
| Very large replies: 200,000 braces, 30,000 unfinished events, 1 MB of prose, 5,000 valid events (the other two cases of TC-ERR-12 are DEF-01) | TC-ERR-12 | each parsed in under 10 ms |
| Unknown object, unknown attribute, value outside the enum, unknown person, invalid date, non-numeric number | TC-ERR-14, 15, 17, 19, 20, 30 | refused as `invalid`; the other events of the reply are applied |
| Invented quote, quote in the wrong turn, empty quote, empty transcript, one-turn transcript, 300 KB turn, Malay, Chinese, Arabic, emoji | TC-ERR-22 to 27, 45 | fail closed (`ungrounded`) or ground to the right span |
| Same meeting ingested twice, re-upload with a typo fixed | TC-ERR-37 | beliefs, timeline and change count unchanged; one source per distinct text |
| Older meeting imported last; a reply that lists a later decision before an earlier one | TC-ERR-38, 39 | slotted into history; current decision stays; "as known on" answers still reproduce the past |
| Extractor or reviewer raising mid-run | TC-ERR-34, 44 | exception propagates (documented); earlier facts intact; the retry succeeds without duplicate sources |
| Refused writes, NaN and Infinity, alias conflicts, stale and double review, retract and correct twice | TC-ERR-46 to 53 | typed error, database unchanged |
| Crash and torn writes: log cut inside a record at 6 positions (1, 2, 10, half, n-2, n-1 bytes), a child process killed at 3 points of a write, damaged database file | TC-ERR-56, 57, 62 | restart opens, acknowledged decisions are present, database equals a replay of the log |
| Corrupt log: duplicated or swapped lines, a blank line, a missing or textual seq, garbage appended, two records on one line, log deleted or emptied | TC-ERR-58 | `LogCorrupt`, log bytes untouched |
| Whole story with restart and rebuild; five shipped chains; 318 recorded real model replies; offline use | TC-ERR-65 to 69 | correct current / as-of valid time / as-of transaction time / change counts; all replies parse; no socket and no `mlx` import |

## 6. Not tested (honest scope)

No language model, GPU or network is used by any test, so the quality of real extraction is not measured here (the evaluation chapter
does that). `MLXExtractor`'s model-loading path is therefore not covered. Several processes writing one ledger at the same time are not
tested. The service layer (`memoria_engine/service.py`, added by another session) only has its own 11 tests (79% line coverage) and
no failure-injection tests were written for it. `demo.py`, `llmcache.py`, `windowed.py` and `evaluation/report.py` are not run by any test (0%) and the
rest of the evaluation scripts are reached only by the existing tests (84.5%); see `coverage.txt`.

## 7. How to apply the fixes later

```
cd /Users/sayyid/Desktop/FYP/engine
patch -p1 < results/testing/proposed_fixes.patch          # or: git apply results/testing/proposed_fixes.patch
/opt/homebrew/bin/python3.11 -m unittest discover -s tests # expect: Ran 217 tests ... OK (no expected failures)
/opt/homebrew/bin/python3.11 scripts/run_test_report.py --coverage
```

Base hashes the patch was made against (first 12 hex digits of SHA-256): `ledger.py` 328e76700cc3, `pipeline.py` d6e7abb9efb5,
`extractors.py` a2fafe3d7392. Applying it changes these hashes, so the AMI manifest must be refreshed by whoever owns that run.
