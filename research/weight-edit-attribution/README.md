# 4B attribution / decision-status experiment

**Outcome: no READY-FOR-VALIDATION candidate**, 3 November 2026. Two prompt
alternatives and the tested static weight adapters fail the source-quality /
current-value screen. **New-val remains unused.** Protocol:
[`PROTOCOL.md`](PROTOCOL.md).

## Scope and baseline

Model: `mlx-community/Qwen3.5-4B-MLX-4bit`
`32f3e8ecf65426fc3306969496342d504bfa13f3`, thinking off, greedy, extraction
budget 1,800. Source code snapshot: `225f709fd27779103ea6dc01058776528a74af4b`.
All artifacts here are optional research-local experiments.

The coordinator cache was copied before consumption. Its frozen complete
SHA-256 is `30329c6d8106f22f778868c6ef640102af118d6b9985db857d29afc63b819472`;
the development-only 511-record subset, input hashes and timestamp are in
[`data/snapshot.json`](data/snapshot.json). Explicit file loading opens only
ES2003 / TS3004 for derivation, ES2011 / IS1008 / TS3006 for screening.

Exact no-model replay:

| Configuration | QA /124 | Current /43 | Gold /60 | Wrong writes | Review proposals |
|---|---:|---:|---:|---:|---:|
| App | 90 | 28 | 26 | 46 | 119 |
| A (rejected on chronology contracts) | 100 | 28 | 28 | 31 | 89 |
| Existing lexical support | 92 | 24 | 24 | 28 | 84 |
| Existing model support, threshold 0 | 87 | 23 | 23 | 27 | 80 |

These are reproducibility checks, not new wins. In particular, less writing
can improve zero-change/none answers while losing current values.
The coordinator has rejected A: repeated old-value recaps can outvote a later
explicit decision, and two genuine within-meeting changes must both survive.
Its 100/124 is **not evidence of a safe product gain**. This experiment uses
the shipped app as its extraction comparator and adds the supplied chronology
fixtures to the development screen.

## Source-labelled diagnostic set

`cases.py` freezes 32 actual cached-app writes: 16 derive and 16 check, each
eight supported and eight unsupported. The set includes wrong component,
tentative alternative, prototype history and numerical-rating mistakes,
alongside informally phrased accepted decisions and supported current-design
recaps. Full reconstructed extraction prompts and surrounding source turns
are retained in `data/cases.json`; the raw baseline reply is retrievable by
`prompt_key` in `data/prompts.json` / `data/cache-dev.jsonl`.

Labels are source judgments with written reasons, not the model's preferred
answer and not simply gold-value equality. Example: TS3004d turn 175 asks
about **button** material; a **case**-material write is unsupported even
though its value happens to agree with the ledger gold. Conversely, an
accurate recap can be supported without being a new gold event. This is a
small, manually selected diagnostic; repeated source windows reduce the
effective sample size, and labels have not had an independent human audit.
The old-dev negative examples also confound error type with series: the ES
examples concern commitment/status, while the TS examples concern binding.
Thus a failed mixed-centroid direction is not evidence that every
attribution-specific component must fail. All case labels and the original
layer selection remain frozen despite this limitation.

Existing controls on these labels (correct /16):

| Control | Derive | Check | Full-dev current QA |
|---|---:|---:|---:|
| Verbatim grounding only | 8 | 8 | 28/43 |
| Lexical support | 9 | 11 | 24/43 |
| Existing support question, threshold 0 | 8 | 14 | 23/43 |

Narrow-probe accuracy is therefore insufficient to recommend a filter.

## Neural hypothesis and context alternative

The actual 4B has 32 layers, 2,560 hidden dimensions and 9,216 MLP neurons.
Residual and MLP-input states are inspected at layers 8, 16, 24 and 28.
These are states at the final prompt token of the contextual YES/NO
diagnostic; transfer to full native extraction is separately tested, not
assumed from probe separability.
Unsupported-minus-supported residual centroids are compared across the two
old-dev series. A layer is selected only by old-dev leave-series-out AUC,
with direction cosine as a tie-breaker. New-dev does not choose the layer.

For a selected unit direction `u` and 16 MLP columns `J`, the static edit is
`W'[:, J] = W[:, J] - alpha * outer(u, u @ W[:, J])`. Columns are selected by
old-dev differential activation times their projection on `u`. Strengths
0.25 and 0.5 are compared with a seeded orthogonal random direction at 0.5,
using the same columns and coefficients, hence the same Frobenius norm.
An adaptive opposite-sign follow-up uses alpha = -0.5 with those same frozen
vectors and columns. It amplifies the selected projection instead of
suppressing it; no layer is chosen from new-dev results.

This is a **static low-rank weight adapter over the original quantized
projection**, not an exported/requantized checkpoint or a trained adapter.
Only one down-projection matrix is temporarily dequantized for inspection;
the inference base stays 4-bit. There are no gradients or optimization loops.
Residual separability by itself does not establish an interpretable causal
component. The suppression can remove a correct rejection signal or merely
bias the model, which is why the random control and generated-output screen
are required.

The simpler alternative adds source-to-entry instructions to the original
extraction prompt: bind the property to its component, inspect nearby
acceptance/rejection, and separate product choices from evaluation ratings
and old prototype descriptions. It uses one extraction call. A separate
quote-only versus neighboring-turn YES/NO diagnostic measures context use;
it is not installed as an extra-call filter.

All calls get fresh KV and recurrent state. Worker prefix caches and the
MLX allocator cache are cleared after every intervention change. Result keys
include the exact intervention hash, strength, revision and rendered prompt.
Model leases go through the shared exclusive launcher, with a 256 MiB cache
limit and a 450-second lease alarm.

## Reproduce

From the worktree root, no-model checks:

```sh
PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/bin/python3.11 -B research/weight-edit-attribution/verify.py
```

`prepare.py` creates the frozen snapshot and baselines on a fresh output
directory; it never replaces result files. `cases.py` creates the frozen
case bundle; `source_controls.py` measures the cached controls.

Model command pattern (local cached weights only):

```sh
PYTHONDONTWRITEBYTECODE=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
  /opt/homebrew/bin/python3.11 \
  /private/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode/run-exclusive.py \
  /Users/Shared/Memoria/runtime/speech/bin/python -B \
  research/weight-edit-attribution/experiment.py diagnose
```

Then `experiment.py edit-probes`, and `extract_screen.py context binding
target random amplify base-regression`, each under that launcher. Each extraction lease
stops starting calls after 390 seconds; completed calls persist and a rerun
continues. `extract_screen.py score` is no-model. Extraction screening is
explicitly **open loop**: ten preselected prompts are regenerated; every
other reply and all prompt beliefs remain frozen to the original app run.
It is not a full-dev closed-loop evaluation.

`contracts.py no-model` checks the injected engine fixtures without weights.
`contracts.py model` runs actual extraction on all three fixtures for base,
both prompts, target and random edits; `followup_checks.py` runs the signed
probe and contract follow-up. Both model commands use the same launcher.
`audit_screen.py results/<extract-screen-summary-file>.json` audits source
and question changes from that report's immutable snapshot. `finalize.py`
collects the completed evidence in `results/handoff.json`; `finalize.py hash`
hashes the final artifact bundle. Result files are immutable; use a fresh
research-directory copy with fresh result paths for a new model run.

Reference: [Weight-Space Programming](https://rikiyat.github.io/blog/weight-space-programming/).
Its successful small-model loop repair motivates targeted investigation;
its unsuccessful ordinary-reasoning edits caution against assuming this
semantic task has the same mechanism.

## Measured outcomes

**Ten-window open-loop screen**, with the other 87 extraction windows and all
prompt beliefs frozen to the app baseline. These are replayed full-dev ledger
metrics, not a closed-loop 97-window model run:

| Condition | QA /124 | Current /43 | Gold /60 | Wrong writes | Review proposals |
|---|---:|---:|---:|---:|---:|
| App baseline | 90 | 28 | 26 | 46 | 119 |
| Context / source-status instructions | 90 | 27 | 25 | 42 | 111 |
| Subject-before-value instructions | 89 | 26 | 26 | 47 | 117 |
| Target suppression, alpha 0.5 | 90 | 29* | 27* | 53 | 124 |
| Matched random, alpha 0.5 | 90 | 29* | 27* | 55 | 124 |
| Target amplification, alpha -0.5 | 90 | 29* | 27* | 54 | 126 |

\* The current/gold gains are **unsupported source attributions**, and the
random edit earns the same false credit. No condition produces a supported
current-value improvement. Alpha 0.25 was screened on the diagnostic probes
only; it is not assigned an extraction score.

The quote-only diagnostic scores 11/16 on derive and 13/16 on check. Adding
neighboring turns yields 12/16 and 14/16; the check set has zero false accepts
but still two false rejections. Context therefore helps this small probe,
but it does not outperform the existing support control's 14/16 check score.

| Layer | Old-series direction cosine | Old leave-series-out AUCs | New-dev direction AUC |
|---|---:|---|---:|
| **8 (selected on old-dev)** | 0.145 | 0.688, 0.813 | **0.500** |
| 16 | 0.056 | 0.500, 0.563 | 0.578 |
| 24 | -0.011 | 0.500, 0.438 | 0.984 |
| 28 | -0.006 | 0.563, 0.500 | 0.984 |

The late-layer check-set separability is not used to switch layers after
looking at the check set. Cross-series direction consistency is weak; the
old-dev-selected direction does not generalize. The selected static delta
touches 16 columns / 40,960 mathematical entries. At strength 0.5 its
Frobenius norm is 0.0708004, or 0.173% of the selected layer's weight norm.
The random control has the same norm. The patch bundle is only 17,002 bytes,
SHA-256 `5c4aa47baeb311467a4bb5229b303bbf0779f59b61bcf4775834a5dc161d1c5b`.

The first full-prompt context intervention **fails**: ten-window open-loop
replacement leaves QA at 90/124, lowers current answers 28→27 and gold events
26→25, while lowering wrong writes 46→42 and proposals 119→111. IS1008's
locator current answer is lost; TS3004's case-material change count improves.
This is the thinning trade-off, not an extraction win. The narrower
subject-before-value prompt omits the extra commitment and rating exclusions.

The narrower binding prompt also fails. The half-strength weight suppression initially appears to gain
one current answer and one gold event (29/43, 27/60), but wrong writes rise
to 53 and proposals to 124. **Both apparent gains are unsupported.**

In IS1008b it attaches nine different entries to turn 43's company-profit
statement, including speech recognition and a battery indicator. The speech
entry matches gold event `IS1008b.t61.1` only because the human-linked evidence
window spans turns 14–117. The battery-indicator hallucination happens to
match the final current answer. Neither gain demonstrates correct extraction.
See `results/audit-extract-screen-summary-57598bdca411.json` and the full
generated reply in its referenced immutable cache snapshot. Gold and scoring
are unchanged; the false attribution is reported separately.

Both suppression strengths (0.25, 0.5), amplification (-0.5), and the matched random direction give
the **same source-classification decisions** as the contextual base probe:
12/16 derive, 14/16 check. The edit has not shown a task-specific diagnostic
improvement. Opposite-sign amplification also fails, adds a malformed reply,
and produces the same unsupported gains. This does not support a stable,
task-specific editable attribution component in the tested setup.

All **18 model/engine chronology checks pass**: base, both prompt
variants, targeted suppression, random control and amplification each retain both real
budget changes at their claim times, keep the later vendor switch over old
recaps, and count unchanged recaps as zero changes. Removing the adapter
restores three source-probe log-probabilities exactly; two guard probes and
the Ask router also return byte-/score-identical baseline outputs. These are
scope/restoration checks, not a held-out guard benchmark.

## Cost, integrity and handoff

| Condition | Generation seconds, ten windows | Median seconds/window | New unclean replies /10 |
|---|---:|---:|---:|
| App (cached comparator) | 159.6 | 11.40 | 0 |
| Context | 95.5 | 8.30 | 0 |
| Subject-before-value | 120.7 | 8.83 | 0 |
| Target suppression | 165.0 | 10.47 | 0 |
| Matched random | 166.4 | 11.34 | 0 |
| Target amplification | 199.5 | 13.48 | 1 |

The context variants' shorter output does not compensate for their recall /
current-value losses. Times exclude queue wait and model load; cached baseline
timings are descriptive, not a synchronized speed benchmark. Maximum measured
MLX allocation was **4.05 GB**; maximum recorded process RSS was **2.26 GB**
(different memory accounting, not additive). Native generation after adapter
removal reproduced the cached ES2003c reply byte-for-byte. On the exact
profit-quotation failure, native-before, zero-norm adapter and native-after
generation were **all byte-identical to the cached base**. The nonzero
conditions' shared false credit is therefore not a zero-adapter or cached
baseline mismatch (`results/zero-control.json`).

Nine no-model verification groups pass: syntax, input hashes, full-prompt
reconstruction, case balance, dev-only loading, historical replay parity,
patch hash, random-norm matching and weight-delta algebra. Evidence is in
`results/verification.json`, `results/chronology-*.json`, per-call JSONL files,
the immutable screen snapshots, and `results/handoff-final.json`.

The retained 17 KB patch is a **negative research artifact**, not a deployment
recommendation. No removal-only filter is proposed: the prompt variants fail
the current-value guardrail before a random-thinning promotion test would be
relevant; neural edits have their matched random-direction control. Gold,
shipping defaults and shared weights were not modified. No final-validation
model calls were made.
