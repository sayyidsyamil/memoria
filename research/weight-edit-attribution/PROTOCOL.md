# Attribution / decision-status intervention (4B)

Written 2026-11-03 15:31 +08 before new results. Branch `weight-edit-attribution`,
source snapshot `225f709fd`. This is a bounded diagnostic, not final validation.

## Hypotheses and splits

- The extractor sometimes binds a mentioned value to the wrong object (rubber
  buttons → rubber case), and sometimes writes an alternative or recap as a new
  decision. A semantic edit is a hypothesis; the published weight-space loop
  repair is not evidence that these errors have one editable cause.
- Derive directions / choose components only on **ES2003, TS3004** (old-dev).
  Check on **ES2011, IS1008, TS3006** (new-dev). Never load old-test or new-val.
- Freeze a small source-labelled set before new inference: wrong-object,
  tentative-versus-final, and correct decisions, including same-word contrasts.
  Each case records source turns, an explanation independent of model scores,
  and its full cached extraction prompt reconstructed by harness replay.
- Gold remains unchanged. Distinguish source-level support from gold-window
  matching: a recap may be supported without being a new gold event.

## Comparisons / bounded interventions

1. Reproduce the app and candidate A from a frozen cache snapshot. Compare the
   existing source-grounding, lexical support, and model support scores.
2. Context control: an extraction instruction emphasizing which object/field
   each value belongs to and the nearby acceptance/rejection, preserving the
   full extraction prompt. A narrow context/quote probe is diagnostic only;
   an extra-call filter must justify its cost and survive random thinning.
3. Inspect the actual 4B architecture and contrastive residual/MLP activations
   on old-dev cases with teacher-forced continuation scores. No gradients,
   optimizers, or training loops. At most three motivated small interventions:
   a contrastive direction at a selected mid/late layer, small strengths, and
   a matched seeded random direction/norm control. A low-rank weight delta may
   wrap a quantized projection without dequantizing the whole model. Pure
   activation steering will be named as such, never called a checkpoint edit.
4. Fresh KV/recurrent caches per call; clear worker prefix state and GPU cache
   on every intervention change. Cache identity includes intervention bytes,
   strength, exact model revision, rendered prompt and decoding configuration.

## Decision rule and reporting

- Primary screen: correct item/value/status on both target cases and correct
  controls. Report every tried condition, malformed output, output tokens,
  latency and peak memory. A score-margin change is not an extraction win.
- Replay changed windows through the pipeline, explicitly open-loop unless
  later prompts were regenerated. Report current-value QA, gold events, wrong
  writes and confirm-all review burden, separately from zero-change/none QA.
- A removal-only candidate must beat 1,000 per-meeting matched random removals
  (QA at least their 90th percentile and more gold kept than their mean), keep
  gold within baseline minus two, and improve current answers. Current answers
  and correct grounded decisions must not be traded for empty ledgers.
- Only a surviving development candidate is READY-FOR-VALIDATION. Coordinator
  owns closed-loop/final validation; otherwise hand off a measured negative or
  a simpler, demonstrably better context intervention.

## Resources / scope

Every model command runs through the supplied `run-exclusive.py`; one model
job at a time, approximately 5–8 minute leases, MLX cache 256 MiB, local cached
4B only. Check for Memoria/unowned resident models without killing them. All
writes stay in this new research directory or the assigned scratch directory.
No shipping edits, shared weight edits, downloads, uploads, UI, or extra agents.
Snapshot live caches before reading; preserve hashes and full per-case outputs.

## Amendments

Append-only, with reasons and timing relative to results.

- 15:39, before any new model results were read: freeze 32 independently
  source-labelled cached-app cases (16 old-dev derive, 16 new-dev check; eight
  positive and eight negative in each). Repeated source windows reduce the
  effective sample size. Keep supported current-design recaps as positive
  support controls; do not score them as new decisions solely from this label.
- 15:39: inspect 4B residual and MLP-input states at layers 8, 16, 24 and 28
  (32-layer model, 2,560 hidden / 9,216 MLP width). Choose a layer only by
  old-dev leave-one-series-out separation and cross-series direction cosine.
  The static adapter suppresses the unsupported-minus-supported residual
  direction in 16 down-projection columns, chosen by old-dev differential
  activation times their projection on that direction. Strengths 0.25 and
  0.5; orthogonal seeded random direction with identical sparse coefficients
  and Frobenius norm at 0.5. This is a falsifiable suppression hypothesis, not
  an assumption that the direction causes errors.
- 15:39: extraction screening uses ten preselected full cached app prompts
  listed by case ID in `extract_screen.WINDOW_CASES`, with source-binding
  instructions, the half-strength adapter, and its matched random control.
  Unchanged windows remain frozen; report this as an open-loop screen. The
  weight adapter runs on the original quantized path with an unquantized
  rank-one delta, not a rebuilt all-4-bit checkpoint. Stop a repetitive reply
  at its first identical repeated event; preserve its already emitted prefix.
- 15:43, after the first diagnostic but before adapter/projection results:
  coordinator rejects candidate A on real engine contracts. Its baseline row
  is historical only. Add three source-supplied development fixtures to all
  extraction candidates: preserve both explicit within-meeting budget changes
  at their `turn.start` claim times; let one later explicit vendor switch
  supersede repeated earlier recaps; retain zero changes for unchanged recaps.
  No majority/modal consolidation is part of this intervention.
- 15:46, after context-v1's ten-window screen: v1 lowers wrong writes 46→42
  but loses a current answer (28→27) and a gold event (26→25), so it fails.
  Continue with a narrower subject-before-value instruction (`binding`),
  removing v1's extra commitment/rating exclusions while explicitly preserving
  accepted informal decisions and all genuine chronological changes. Same
  ten windows, same baseline, no extra model calls per extraction. The neural
  arm's layer/columns/strengths remain frozen from old-dev.
- 15:58, after the complete target-half-strength screen (random control still
  incomplete at a lease boundary): suppressing the direction gives current
  29/43 and gold 27/60 but raises wrong writes 46→53 and proposals 119→124;
  it fails. Test the opposite sign, alpha = -0.5, with the same old-dev-derived
  direction and columns. This tests whether the axis encodes useful rejection
  information rather than an error-causing feature. The existing orthogonal
  random direction at +0.5 has the same Frobenius norm and remains the matched
  control. No layer or neurons are reselected from new-dev. This is an adaptive
  development follow-up, not a held-out confirmation. Complete the random
  control and include all chronology fixtures for this signed variant.
- After the signed generation screen: all three nonzero edits earn the same
  unsupported current/gold gains on the company-profit quotation. Add a
  zero-norm adapter and native-before/after regeneration on that exact prompt
  to distinguish a generic small-perturbation response from an adapter-path or
  baseline-replay artifact. This is a parity check, not another candidate.
