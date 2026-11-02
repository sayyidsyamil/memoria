# Firmness gate: a narrow YES/NO check between extraction and the ledger

**Question.** The October ledger (Qwen3.5-4B, AMI test: 59/96 answers; extraction P 21%, R 67%) mostly fails by
taking tentative remarks as decisions: 15 of 16 wrong current values hold a different value, all 21 wrong change
counts are over-counts. Does asking the same model one narrow question per extracted event ("is VALUE for ITEM firmly
decided here?"), and keeping the event only when log P(YES) − log P(NO) ≥ τ, cut those errors and the review inbox at
a small recall cost?

**Answer.** The preregistered primary comparison favoured the gate (59 → 67 of 96; exact sign test p = 0.039), but
not for the reason hypothesised. Removing the same number of events *at random* gives the same accuracy (67.4 on
average; post hoc). The gain is in change counts (12 → 19 of 33), which any filter that writes fewer events earns;
current values barely move (18 → 19 of 34). The gate does raise extraction precision (21% → 30%) and keeps more gold
events than random thinning, but costs 5 of 31 found events (recall 67% → 57%). With a careful reviewer it adds
nothing (85 → 85) and, under the app's review-everything policy, loses 4 answers (88 → 84) while shrinking the inbox
from 4.6 to 3.0 suggestions per meeting. The 4B model judges the *tone* of commitment, not whether the excerpt
settles the entry.

## Method

- **Replay, no extraction model.** `replay.py` runs the October pipeline exactly as in October (all extraction and
  router calls are hits in `ledger-engine/results/cache`; a miss stops the run), takes each meeting's candidates and
  hands the ones the gate keeps to a fresh pipeline with the same policy. The October `run_memoria` (ledger, router,
  scorer, sign test) does the rest, unchanged. With the gate off the replay is identical to the stored October runs
  (dev, test, test with reviewer), checked at every test run.
- **Gate** (`gate.py`). Asked only about candidates the pipeline would write (grounded, valid). System line, an excerpt
  (3 turns before, the quoted turn marked `>>`, 2 after; context turns clipped to 300 characters), the quote, the entry
  `ITEM (attribute) = VALUE`, then the question. Scored by the app's running Qwen worker through
  `src-tauri/resources/memory/qwen_scoring.py` (`first_token_logprobs`, YES − NO, exactly what `score()` returns).
  Every score is cached in `results/gate_scores.jsonl`; rescoring 20 cached prompts gave identical values.
- **Wordings** (fixed before scoring): `w1` the bare question; `w2` the question plus YES/NO rules and five examples
  from an unrelated meeting series (the full text is in `preregistration.json`).
- **Design rule** (fixed before any score existed; see the end of this file): wording by dev AUROC (gold-matched vs
  other events), context variant; τ on the integer grid −8..8 by dev QA, ties by dev F1, then |τ| smallest.

## Dev (8 meetings, 45 questions, 23 gold events, 73 events reach the ledger)

| Configuration | AUROC gold-matched vs other | best dev QA (τ) |
|---|---|---|
| w1, quote + context | 0.486 | 35 (no gain at any τ) |
| **w2, quote + context** | **0.525** | **38 (τ = −3)** |
| w1, quote only | 0.421 | 35 (no gain at any τ) |
| w2, quote only | 0.499 | 35 (no gain at any τ) |

Curve for the chosen wording (`w2`, context); October: 73 events, P 21%, R 65%, QA 35 (current 12/16, changes 10/16):

| τ | events kept | precision | recall | F1 | QA /45 | current /16 | as of /13 | changes /16 |
|---|---|---|---|---|---|---|---|---|
| −5 | 72 | 21% | 65% | 32% | 35 | 12 | 13 | 10 |
| −4 | 65 | 20% | 57% | 30% | 35 | 12 | 13 | 10 |
| **−3** | **48** | **27%** | **57%** | **37%** | **38** | **11** | **13** | **14** |
| −2 | 31 | 29% | 39% | 33% | 34 | 10 | 13 | 11 |
| −1 | 20 | 30% | 26% | 28% | 32 | 8 | 13 | 11 |
| 0 | 8 | 0% | 0% | 0% | 27 | 3 | 13 | 11 |
| ≥ 3 | 0 | – | 0% | 0% | 24 | 0 | 13 | 11 |

The model is NO-biased (only 8 of 73 events score ≥ 0), so τ sits at −3. The dev gain is one grid point wide
(5 questions gained, 2 lost, p = 0.45) and the AUROC is at chance; the preregistration says so.

**Ablation (dev only), w2 at τ = −3:** quote + context keeps 48 events, F1 37%, QA 38; quote only keeps 49, F1 31%,
QA 34 (its own best τ gives 35 = no gain). AUROC 0.525 vs 0.499. Context helps a little, within noise.

## Preregistration

`preregistration.json`, written 2026-11-02 20:41:39 +08 before any test event was scored, SHA-256
**`0f51d955eca67af930a838cb409548deaff2134d9e35c20681106204f78ab71b`**. It fixes w2, context, τ = −3, the prompt
(SHA-256 `158bd991…6da`), the endpoints, and the SHA-256 of `gate.py`, `replay.py`, `experiment.py`, the data and the
caches; `experiment.py test` refuses to run if any of them changed, and refuses a second run.

## Test (20 meetings, 96 questions, 46 gold events) — the single run

| | October ledger | with the gate | October + perfect reviewer | with the gate + perfect reviewer |
|---|---|---|---|---|
| All questions | 59/96 (61%, 52–71) | **67/96 (70%, 60–78)** | 85/96 (89%, 81–94) | 85/96 (89%, 81–94) |
| Current value | 18/34 | 19/34 | 29/34 | 28/34 |
| Value on a date | 29/29 | 29/29 | 29/29 | 29/29 |
| Number of changes | 12/33 | 19/33 | 27/33 | 28/33 |
| Paired sign test vs October | | 10 gained, 2 lost, **p = 0.039** | | 3 gained, 3 lost, p = 1.0 |
| Events written (per meeting) | 7.35 | 4.35 | 7.35 | 4.55 |
| Gold events found (TP) | 31 | 26 | 33 | 29 |
| Extra events (FP) | 116 | 61 | 114 | 62 |
| Precision / recall / F1 | 21% / 67% / 32% | 30% / 57% / 39% | 22% / 72% / 34% | 32% / 63% / 42% |
| Suggestions per meeting, `confirm_conflicts` (October's measure) | | | 1.75 (35, max 10) | **0.75** (15, max 3) |
| Suggestions per meeting, `confirm_all` (the app's policy) | | | 4.6 (92, max 18) | **3.0** (60, max 9) |
| QA under `confirm_all` + perfect reviewer | | | 88/96 | 84/96 (0 gained, 4 lost, p = 0.125) |

Accuracy intervals are Wilson 95%. The gate kept 87 of 147 events. Wrong current values: 15 wrong *values* and 1
"nothing recorded" in October; 9 and 6 with the gate (2 of those 6 were right in October). Wrong change counts:
21 over-counts in October; 13 over, 1 under with the gate.

**Does the gate remove what a perfect reviewer would accept?** Yes. Of the 13 proposals the reviewer accepted in
October's review run, the gate removes 5: one true decision (TS3007d, the series' only real change of energy source,
"The kinetic thing, can we just skip it…"), three wrong-value proposals the reviewer would have corrected, and one
duplicate. That one decision costs two answers (TS3007 current energy and its change count). Under the app's
review-everything policy the gate costs 4 answers.

**Latency.** 0.56 s per event (median; mean 0.68, p90 0.79, max 3.4) on the app's shared worker, 5.0 s per meeting,
about 8% on top of the 63 s the October extraction took per meeting.

## Post-hoc controls (not preregistered; no model calls; nothing tuned on test) — `posthoc.py`

| Test, 147 events | QA /96 | current | changes | gold found | extra | wrong current values |
|---|---|---|---|---|---|---|
| October (nothing removed) | 59 | 18 | 12 | 31 | 116 | 15 |
| Gate (60 removed) | 67 | 19 | 19 | 26 | 61 | 9 |
| 60 removed at random (1000 draws), mean [95% range] | 67.4 [61–74] | 19.1 | 19.4 | 20.4 | 66.6 | 11.6 |
| Same per-meeting counts at random, mean [95% range] | 66.7 [61–73] | 18.4 | 19.3 | 22.6 | 64.4 | 11.6 |
| Extractor's own confidence ≥ 0.8 (chosen on dev) | 65 | 18 | 18 | 27 | 80 | |

60% of random thinnings answer at least as many questions as the gate. The gate's one edge over random thinning is
in the failure mode: fewer confidently wrong current values (9 against 11.6 on average), replaced by "nothing
recorded", not by right values. On dev the chosen τ did beat random thinning
(38 vs 35.0 on average; 5% of draws reach 38), which is what selecting the best of 17 thresholds on 45 questions buys.
Test AUROC of the gate score: 0.77 for gold-matched vs other events (dev: 0.53), 0.66 for events whose value agrees
with gold vs not. The extractor's own confidence (two or three distinct values) gives 0.59 on test and 0.66 on dev:
neither signal is stable across the splits. So the gate carries some signal about extraction quality on test, but it
does not reach the answers.

## Failure cases (test, immediate run)

True events the gate dropped (5 of 31; three within 0.4 of τ). AMI decisions are voiced as suggestions, questions,
reports and descriptions of the agreed design; the gate is right that these are not firm *in form*:

| score | meeting | entry | quote |
|---|---|---|---|
| −4.38 | TS3007d | energy = battery only | "The kinetic thing, can we just skip it, because uh you have to shake it…" |
| −3.62 | TS3003c | case curve = single curved | "Kay. I suggest um the single curved, because maybe the curve is pretty good…" |
| −3.38 | ES2014c | power = kinetic | "You were you were wanting to go for the kinetic power supply." |
| −3.25 | ES2004d | LCD colours = black and white | "The black and white touch screen wherein people can" |
| −3.12 | IS1009d | LED colour = fluorescent green | "…for the light emitting diode it is a fluorescent green…" |

Extra events it kept (61). Highest-scored: recaps restating a value already decided ("Okay. So uh I think we have
decided on the things…", +2.4 and +1.4; harmless), wrong values in firm-sounding turns (ES2014b panel = excluded,
+1.1; ES2014c speech = excluded, +0.9). The clearest failure: the extractor attached seven different entries
(speech, panel, case, chip, curve, buttons, power) to "I'm sure we'll have by the end of today.", said while the
team waited for a device to catch up; the gate kept all seven, speech recognition = included at +0.75. Also kept:
"Okay, you all switched on." (battery type = kinetic, −1.9) and "That's zero." (energy, −3.0, exactly at τ). The
model answers the tone ("we'll", "okay", "decided"), not the entry.

## Threats to validity

- **Open loop.** The extractor's output is held fixed. In 6 of 20 test meetings the gated ledger's beliefs differ from
  October's when the meeting is read, so a live system would have prompted the extractor differently there.
- **Gold.** AMI gold lists the decisions in the human abstracts, one event each; restatements count as extra, so
  precision is a lower bound (on dev, 54 of 73 written events agree with the gold value in force). The evidence
  windows from the summary links are wide.
- **Size.** 96 questions, 46 gold events, 5 teams. One preregistered primary test; the rest are uncorrected secondary
  or post-hoc comparisons. The dev choice was a one-point peak with chance-level AUROC.
- **Same model.** The gate is the extractor's own 4B model; their errors are correlated. Scores are bf16 (steps of
  0.125), deterministic, but several events sit on or near τ.
- **Latency** was measured on the app's serial worker while other sessions may have used it (on dev the shorter
  quote-only prompts of `w2` were slower than the context ones); treat it as indicative.
- **Revision.** The gate used `Qwen3.5-4B-MLX-4bit` at `32f3e8e…`; the October cache records the model id, not its
  revision.

## For the app (not applied)

`SharedExtractor` (`src-tauri/resources/memory/temporal_service.py`) could apply it after `parse_events`/`repaired`:
ground each candidate in `context.meeting` (`pipeline.ground`), build `gate.messages(...)`, call
`qwen_scoring.score(...)` on the already-warm worker and drop candidates below τ, keeping the candidate when scoring
fails (a lost decision is worse than an extra suggestion). Note that it sees one window at a time, so turns at a
window's edge lose context; gating `candidates` in `temporal_api` right after `shared.extract(...)` sees the whole
meeting. Expected effect on AMI-like meetings under the app's `confirm_all`: about 35% fewer suggestions (4.6 → 3.0
per meeting), about 0.6 s per candidate, and a careful reviewer ends with a slightly worse ledger (88 → 84 of 96),
because true decisions never reach the inbox. On this evidence I would not ship it as a filter; ordering or flagging
the inbox by the score keeps every decision reviewable but is unmeasured.

## Reproduce

From `research/firmness-gate`, with `/opt/homebrew/bin/python3.11` (no model is needed while the caches are present):

```sh
python3.11 experiment.py dev            # dev curve, ablation, choice      -> results/dev.json
python3.11 experiment.py test --replay  # recompute the test run, compare  -> "REPLAY IDENTICAL"
python3.11 posthoc.py                   # random thinning, confidence gate -> results/posthoc.json (about 35 min)
```

Scoring new events needs the running app's worker and `--live`:
`export MEMORIA_QWEN_SOCKET=$(print -r -- ${TMPDIR%/}/mm-$(pgrep -f /Applications/Memoria.app/Contents/MacOS/memoria | head -1)-*-qwen.sock)`.
The order used: `experiment.py dev --live`, `experiment.py prereg`, `experiment.py test --live` (once).

Files: `gate.py` (question, scorer, cache), `replay.py` (October replay with a gate), `experiment.py` (dev, prereg,
test), `posthoc.py`, `preregistration.json`, `results/` (`gate_scores.jsonl`, `dev.json`, `test.json`,
`test_run.log`, `posthoc.json`, `posthoc_run.log`). Nothing under `research/ledger-engine` or `memoria_engine` was changed.

## Design protocol (written before any gate score was computed)

- Configurations scored on dev: wording `w1` (the bare question) and `w2` (question + YES/NO rules + five examples from
  another domain), each with `context` (3 turns before, the evidence turn, 2 after; context turns clipped to 300
  characters) and `quote` (the quote only). Nothing else is tried unless both wordings fail; anything extra is reported.
- Wording: the higher dev AUROC (events matched to a gold event vs all other events that reached the October ledger),
  context variant; a tie goes to `w1`.
- Threshold: integer grid tau = -8..8; the tau with the best dev QA (ext+router, 45 questions); ties by dev extraction
  F1; then the tau closest to 0, then the lower one.
- The test configuration is the context variant (the hypothesis); the quote-only variant is an ablation on dev only.
- The test split is touched once, after `preregistration.json` is written and its SHA-256 recorded.

Both wordings were near chance on dev; nothing else was tried, so that the dev result would not be tuned further.
