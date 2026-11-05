# Baseline audit: what an empty record scores

3 November 2026, no model. `python3.11 baseline_audit.py` recomputes everything below from the real engine and the
cached results (9 s) and writes `results/baseline-audit.json` (counts, per-type scores, paired sign tests). Nothing
under `research/ledger-engine`, the engine or any historical result was changed.

**Method.** An empty record is the real `Pipeline` fed by an extractor that proposes nothing; its answers come from
October's own answer functions: `oracle.ledger_answer` with the structured question (exact routes) and
`router.routed_answer` with the routes the cached runs actually used. Every other row is read from its cached result
file and compared with the empty record question by question (exact two-sided sign test on the discordant questions).

These post-hoc, question-level tests are exploratory. They do not account for dependence within a meeting series;
a non-significant difference does not establish equivalence.

## The original 96 questions (October's AMI test split)

38 of the 96 questions need a recorded value or a real change: all 34 current-value questions and 4 of the 33
change counts. **All 29 past-date questions ask about a date before anything was decided (gold "none")**, and 29 of
the 33 change counts are 0. An empty record therefore answers 58/96 right, with exact routes and with October's own
routes alike.

| system (cached result) | all /96 | current /34 | past date /29 | changes /33 | real changes /4 | need a value /38 | empty answer right /58 | vs empty record: system only / empty only, p |
|---|---|---|---|---|---|---|---|---|
| **empty record** (real engine, nothing extracted) | **58** | 0 | 29 | 29 | 0 | 0 | 58 | |
| October ledger, Qwen3.5-4B (the 61% headline) | 59 | 18 | 29 | 12 | **0** | 18 | 41 | **18 / 17, p = 1.0** |
| app's Ask on October's ledger (app-parity replay) | 58 | 18 | 29 | 11 | 0 | 18 | 40 | 18 / 18, p = 1.0 |
| October ledger + perfect reviewer | 85 | 29 | 29 | 27 | 2 | 31 | 54 | 31 / 4, p < 0.001 |
| October full context + CoT, Qwen3.5-4B | 41 | 24 | 6 | 11 | 2 | 26 | 15 | 26 / 43, p = 0.053 |
| October BM25 k = 12, Qwen3.5-4B | 37 | 22 | 14 | 1 | 1 | 23 | 14 | 23 / 44, p = 0.014 |
| ledger, DeepSeek V4.1 Flash extractor | 82 | 29 | 28 | 25 | 2 | 31 | 51 | 31 / 7, p < 0.001 |
| full context + CoT, DeepSeek | 81 | 30 | 24 | 27 | 3 | 33 | 48 | 33 / 10, p < 0.001 |
| gold facts (router only) | 96 | 34 | 29 | 33 | 4 | 38 | 58 | 38 / 0 |

**What this means, read plainly.**
- On this reused set, **no paired difference is detected** between the October 4B ledger's 59/96 (61%) and recording
  nothing (58/96; 18 questions only the ledger gets right, 17 only the empty record, p = 1.0). That is not evidence
  that the two perform equally; it means the aggregate cannot show extraction value here. The ledger finds 18 of the
  38 values or changes the questions need, and loses 17 of the 58 "none"/0 answers to wrong writes.
- The published comparisons stay as published (ledger 59 against full context 41 and BM25 37, all with the 4B), but
  they must be read by question type. On the 38 questions that need a value, the 4B ledger (18) is behind full
  context (26) and BM25 (23). Its lead overall comes from the 58 questions whose answer is "none" or 0, where it
  answers 41 and the text baselines 15 and 14: a ledger with little in it does not invent past values or changes,
  while the baselines do. That is a real property, but it is not extraction quality.
- Two results do show extraction value beyond the floor: a perfect reviewer on the 4B's proposals (31/38 needed
  values, p < 0.001 against the empty record) and the DeepSeek extractor (31/38, p < 0.001).
- Current values and real changes must be reported separately from the aggregate: the 4B ledger has 18/34 current
  values and **none of the 4 real (non-zero) changes**; its 12/33 change counts are all zeros it did not spoil.
  The 29 past-date questions test no past value at all on this split (every gold answer is "none").

## The 124 development questions (this folder)

55 of 124 need a value or a real change (43 current, 1 past date, 11 change counts); the empty record answers 69.

| system | all /124 | current /43 | past date /38 | changes /43 | real changes /11 | need a value /55 | empty answer right /69 | vs empty record |
|---|---|---|---|---|---|---|---|---|
| **empty record** | **69** | 0 | 37 | 32 | 0 | 0 | 69 | |
| app path at `f45bbe549` / 0.3.1 (historical) | 90 | 28 | 36 | 26 | 3 | 31 | 59 | 31 / 10, p = 0.002 |
| request without the system message | 95 | 27 | 37 | 31 | 6 | 33 | 62 | 33 / 7, p < 0.001 |
| candidate A (**rejected for default deployment**) | 100 | 28 | 37 | 35 | 7 | 35 | 65 | 35 / 4, p < 0.001 |

Of A's +10 over the historical app path on dev, 4 are real changes it gets right (3 -> 7 of 11) and 6 are "none"/0
answers it no longer spoils; its current values are unchanged (28/43). Development numbers were used for selection.

The empty-record floor reported earlier in this folder (58/96, 69/124) was first counted from gold answers that are
"none" or 0; the real engine and both routers give the same numbers.

## Scorer: credit without a supporting source

The October scorer counts a write as a gold event when its slot and value match within the event's evidence window,
which comes from the human summary links and can be very wide:

| split | gold events | median turns accepted | events accepting any turn in a window over 50 turns | widest |
|---|---|---|---|---|
| October test (old-test) | 46 | 8 | 13 | 369 |
| old-dev | 23 | 7 | 8 | 298 |
| new-dev | 37 | 27 | 15 | 339 |

The attribution specialist found the consequence in practice (`research/weight-edit-attribution`, branch
`weight-edit-attribution`, README "Measured outcomes"): a weight-edited extractor attached nine entries to one
turn about company profit; one of them was counted as a found gold event only because that event's window spans
turns 14-117, and another matched the final current value by chance, while a matched random-direction edit earned
the same false credit. Gold events found and current-value QA can therefore reward writes whose quote does not
support them. The error runs both ways: wide windows over-credit such writes, and incomplete gold under-credits true
decisions the abstract did not list (they count as false writes), so the scorer's precision and recall are not
bounds in either direction. Gold and scoring are unchanged here; a gain in gold events or current values needs a
source audit before it counts.

## Baselines for the final validation

- Every "app" number in this folder is the **historical app path of `f45bbe549`**. Its app modules
  (`temporal_service.py`, `model_server.py`, `ask_facts.py`, `live_guard.py`, `live_assistance.py` and the modules they
  import) are byte-identical, by git blob, to the `v0.3.1-uat` release tag, and since 3 November 18:45 they are loaded
  from the pinned copies in `pinned/f45bbe549` with every hash checked (`pinned.py`); before that the harness imported
  them from the checkout. `main` has changed two of them since: `temporal_service.py` (amounts stated in words kept,
  `98440ef50`; exact numeric comparison, `7636708c2`; signed, decimal and scaled amounts, `70707fa3b`) and
  `live_assistance.py` (semantic matching with a single approved decision, `44e190870`); the cue explanation that keeps
  older source quotes is a frontend change (`ecbd33b3e`). The cached figures here are historical and are not current
  `main`.
- Before the reserved validation is run, the contemporary production baseline must be chosen and frozen explicitly
  as its own identity (its commit and pinned app files, an entry in `validate.BASELINES`) beside every candidate; the
  validation then compares candidates with that baseline, and reports the empty-record floor and the per-type and
  needs-a-value scores beside the aggregate.
- Candidate A stays frozen as recorded (`results/validation/candidate-A.json`) and is rejected for default deployment
  on the product-contract fixtures (`test_modevalue_contract.py`). No generation or scoring has touched the 247
  reserved questions; their chain files were parsed into memory by the folder-wide loader used until 18:45 on
  3 November (see PROTOCOL.md), which now reads only the requested file.
- Reproduction: `test_integrity.py` recomputes this audit and the dev tables with every reserved file denied at the
  Python file-open audit event and checks them against `results/baseline-audit.json` and `results/dev/summary.json`
  (identical, in this worktree and in a checkout of `main` at `c9357d693`).
