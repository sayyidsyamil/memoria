# Round 2 — native object selection and explicit component choices

**Final outcome: no qualifying development/validation candidate.** The
shadow-vocabulary procedure fixes a narrow, source-verified binding problem,
but its full-window transfer does not improve current-value QA and produces
unsupported off-target assertions. The bounded screen is complete; no further
tuning on these checks is proposed. No weights were edited in this round.

Authoritative evidence: [`results/final-handoff.json`](results/final-handoff.json),
[`results/source-audit-final.json`](results/source-audit-final.json), and
[`results/final-verification.json`](results/final-verification.json).

## Baseline and boundaries

- Historical code/data: `225f709fd27779103ea6dc01058776528a74af4b`; frozen
  round 1: `cc51a9a5e`. Model: `mlx-community/Qwen3.5-4B-MLX-4bit`
  `32f3e8ecf65426fc3306969496342d504bfa13f3`, thinking off, greedy, 1,800 tokens,
  historical app system message and repair path.
- **This is not current-main performance.** The parent's newer amount,
  singleton, HUD, pinning and loader changes were not silently substituted
  into this historical baseline. Parent handles main/private-report integration.
- All **55 round-1 artifact hashes remain unchanged**. Round-2 cases were
  frozen before their calls; the first phase is committed at `04a1b5df5`.
- Exact named development files only. No old-test or reserved 247-question
  generation/scoring. No paid calls, shipping/default/shared-weight edits.
- Candidate A, the layer-8 adapter and naive repeat stopping remain rejected.
  The research driver had a repeat-stop guard configured, but it fired **zero
  times** across all 119 round-2 generated replies; no result depends on it.

## Frozen cases and native measurement

`data/cases.json` contains 24 controlled fixtures and six unmodified-source
fixtures. Derivation uses four OLD-DEV anchors: ES2003b/c and TS3004c/d.
Checks use IS1008d and TS3006d anchors, plus natural IS1008b/d and TS3006d
sources. There are 19 derivation and 11 check generation fixtures.

Each controlled anchor varies case versus buttons while keeping the property,
value, source context and commitment wording matched. Dual registries contain
both valid component/property choices; single registries leave the button
property untracked. An antecedent-only contrast keeps the quoted answer
identical. Original full cached-prompt hashes and source turns are retained;
the initial diagnostic uses short excerpts, not full meeting windows.

These are **AI-assisted source labels, not independent human gold**. Repeated
anchors are not independent samples. Natural fixture `n2` is input-identical
to controlled `p3-0-buttons` under shadow augmentation: 30 fixtures, 29 distinct
shadow requests. `results/duplicate-fixture-proof.json` proves the equality;
comparisons below use matched case sets, not an extra inferred observation.

Teacher forcing ends at the native JSON `object_id` selection position, after
the turn and exact quote. Prefix+target strings are tokenized jointly; a
common token prefix handles BPE boundary merges. **Complete identifier and
closing-delimiter log probabilities are summed**, including IDs sharing token
prefixes. All 72 candidate-continuation sums were verified. These are
conditional likelihood rankings, not free-generation accuracy: a model can
omit an untracked event before ever reaching this position.

| Native full-sequence ranking | OLD derive | NEW check |
|---|---:|---:|
| Both component/property IDs registered | 8/8 | 4/4 |
| Only case registered; source describes case | 4/4 | 2/2 |
| Only case registered; source describes buttons → null | **0/4** | **0/2** |
| Total | 12/16 | 6/8 |

At layers 7, 17 and 25, old-pair leave-one-anchor-out direction cosines had
medians **0.498, 0.736, 0.721**; all four held-pair projections were positive
at each layer. Centered MLP-input directions distinguished 7/8 held-out
subjects. Component identity is consistently represented in these probes.
The neural-edit gate required at least two old dual-tracked ranking errors;
there were **zero**. It closed before editing. No activation/weight candidate
or random-direction weight control was run, and no layer was chosen from
previously observed new-dev AUCs.

The observed boundary is registry coverage: once a component/property lacks
an available ID, the forced event is assigned to a nearby tracked slot.
This does not prove a defective neuron or that every free-generation error
has this cause.

## Actual generation procedures and results

1. **Subject-first fields:** generate `subject_turn`, `subject_quote` and
   `value_quote` before the ordinary object/attribute/value fields. This is
   generated intermediate structure, not just another reminder.
2. **Generic sentinel:** offer `__untracked__` as an explicit abstention
   choice and translate only that ID to null. Rejected on the 12-case old
   screen without extending to checks.
3. **Specific shadow choices:** add extraction-only button-material and
   enter-button-curve counterparts of case properties, then project only
   the added IDs to null. Genuinely registered button fields are protected.
   This is a fixed, **domain-specific** vocabulary, not automatic discovery
   of arbitrary untracked concepts. It uses no expected labels at runtime.

Source scoring requires the correct component/property/value and a grounded,
value-bearing quote at its annotated assertion. Omission does not earn credit
on supported decisions. Unrelated decisions within multi-decision turns are
required recall controls. Coarse gold-window matching is not used here.

| Procedure / matched scope | Found source bindings | Wrong writes | Complete cases | Unclean |
|---|---:|---:|---:|---:|
| Native, all 30 | 28/38 | 6 | 17/30 | 1 |
| Subject-first, same 30 | **20/38** | 4 | 18/30 | 0 |
| Native, sentinel's 12 old cases | 12/14 | 2 | 8/12 | 0 |
| Generic sentinel, same 12 | 12/14 | 2 | 8/12 | 0 |
| Native, shadow's 29 matched cases | 28/38 | 6 | 16/29 | 1 |
| Shadow choices, same 29 | **29/38** | **3** | 20/29 | 0 |

Exact derivation/check breakdown:

| Procedure | Derive found / expected; wrong | Check found / expected; wrong |
|---|---|---|
| Native | 17/20; 2 (19 fixtures) | 11/18; 4 (11 fixtures) |
| Subject-first | 17/20; 2 (19) | **3/18; 2** (11) |
| Shadow | 17/20; 0 (18 distinct requests) | 12/18; 3 (11) |

Subject-first loses eight supported bindings across five IS1008 fixtures;
its extra complete case is merely `[]` becoming `{"events":[]}`. It fails.
The sentinel changes no source outcomes. Shadow's old gate removed two wrong
writes without losing any previously found binding, warranting the frozen
check expansion. It subsequently fixes one check-side button/case confusion
and finds one additional LCD inclusion, citing the explicit “we've incorporated
the L_C_D_ screen … as part of the design” clause. No source binding previously
found by the matched baseline is lost. Raw/effective replies and source
citations are in `results/source-change-audit.json`.

## Transfer, source audit and chronology

Only **four original full OLD-DEV windows** were regenerated: two known
misbindings and two correct-control windows. The other **93/97 windows** and
all prompt beliefs stayed frozen. This is open loop, not a closed-loop full-dev
model run.

| Historical ledger replay | QA /124 | Current /43 | Gold /60 | Wrong values | Proposals |
|---|---:|---:|---:|---:|---:|
| App | 90 | 28 | 26 | 46 | 119 |
| Four shadow-window replacements | 91 | **28** | 26 | 44 | 116 |

Both targeted source errors disappear and all four source-supported control
decisions remain (**6/6 focus checks**, with positive quotes checked verbatim
checked against source text and their values). But the only QA gain is a
change-count question. **Current-value QA does not improve.**

The wider source audit also finds four newly produced/anchored unsupported
assertions: chip requirements interpreted as speech exclusion; coloured buttons
as the remote's overall colour; speech-control placement as speech exclusion;
and a transparent/replaceable front as LCD inclusion. Two happen to agree with
gold values. They are **not source-valid gains**. Some replace earlier bad
writes, so four is not a net-error count. This off-target behaviour and flat
current QA prevent promotion; the narrow fix is not a general extraction win.

All actual chronology runs pass: **6/6** supplied budget/vendor fixtures for
native and subject-first; **8/8** active material-domain fixtures for native
and shadow. The latter preserve two changes at their distinct claim times,
a rare final change after recaps, an unchanged case despite a later untracked
button decision, and a genuinely registered button-material decision. The
baseline also passes these fixtures; no synthetic current-answer gain is claimed.

## Calls, cost and verification

- Extra product calls: **zero** for every tested procedure (one generation).
- Research work: 72 scored native target continuations; 101 fixture generations;
  14 chronology generations; four full-window generations.
- All-30 generation: native **89.9 s**, subject-first **239.0 s**. Matched-29:
  native **88.0 s**, shadow **91.1 s**. Sentinel-12: **60.4 s** vs **33.0 s**.
  Four full windows: **36.1 s** vs historical cached **49.8 s**, with 1,072 vs
  873 output tokens. Timings exclude queue/load and are descriptive, not a
  synchronized speed benchmark.
- Actual new-call peak MLX allocation **3.99 GB**; recorded process peak RSS
  **2.28 GB** (different accounting, not additive). Cache limit 256 MiB;
  longest recorded model lease 347 s. Fresh KV/recurrent and worker prefix
  state per call. **Zero repeat cuts and zero new budget hits.**
- The seven source-grader checks replay exactly; all 72 full-sequence sums,
  frozen case/code hashes, source-score replays, duplicate-input proof,
  14 chronology outcomes and four positive full-window quotations pass.
  All 55 first-round hashes remain unchanged. No model calls were needed
  after outage recovery to finalize these results.

`results/final-handoff.json` gives exact per-case/subset numbers and scope.
`finalize.py` reproduces the no-model audit from immutable snapshots and
refuses to overwrite result files. `finalize.py check` instead compares the
recomputed audit with the saved artifacts without writing anything:

```sh
PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/bin/python3.11 -B research/weight-edit-attribution/round2/finalize.py check
```

`verify.py` contains the source-grader
checks. Model drivers are retained for reproducibility, **not an instruction
to rerun them or final validation**; all historical model invocations used the
shared `run-exclusive.py`. This directory's `artifact-hashes.json` seals the
final round-2 files separately from round 1.
