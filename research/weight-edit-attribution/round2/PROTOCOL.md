# Round 2: native component binding, paired sources

Frozen before new model calls, 2026-11-03. Round 1 (`cc51a9a5e`) and its 55
artifact hashes remain immutable. The layer-8 adapter is rejected and is not
used here.

## Hypothesis and data

Binding can fail at native JSON `object_id` selection even when an auxiliary
YES/NO verifier recognizes the source. Test native JSON continuations, with
no YES/NO question. Paired source contexts differ only in the named component
or its immediately preceding antecedent; the property/value and series are
held fixed. Firm wording is held fixed to avoid learning commitment tone.

- Derive: four OLD-DEV anchors, two ES2003 and two TS3004. Controlled source
  variations compare case versus buttons with the same material/curve.
- Each anchor has a dual-tracked registry (both components can legitimately
  receive the SAME value) and a single-tracked registry (buttons untracked).
  The latter explicitly tests correct null/unresolved or omission.
- Check: two NEW-DEV anchors, IS1008 and TS3006, constructed the same way.
  Add unmodified old/new attribution failures as natural-source controls.
- Input is the app extraction prompt reconstructed from frozen replay, with
  a short source excerpt and the documented controlled changes. Full original
  prompt hashes and source text are retained. These are diagnostic fixtures,
  not a full-development extraction run or edited gold.
- Freeze all expected source-level item/value bindings before model calls.
  Other known decisions in a source excerpt are preserved as recall controls.
  No old-test/new-val inputs or model calls.

## Native measurements and localization

Teacher-force the native event prefix through `turn`, exact `quote`, then stop
immediately before `object_id`. Score the COMPLETE identifier (including its
closing delimiter), not its first token. Tokenize prefix+target jointly and
use the common token prefix so BPE merges at the boundary are not mis-scored.
Include identifiers sharing a prefix, e.g. `case_material` and
`case_button_material`, as well as null. Report per-token and summed log P.

Inspect residual and MLP-input activations at the native selection position
on a small preregistered grid: layers **7, 17, 25** of the actual 32-layer 4B
(early contextual, middle, late). These choices do not use round 1's new-dev
AUCs. Derive case-minus-button differences WITHIN source pairs, using only
dual-tracked OLD-DEV cases; never contrast all valid writes against nulls.

A neural intervention is warranted only if (a) native object selection makes
at least two OLD-DEV errors and (b) a component transfers across held-out OLD
anchors (at least 3/4 positive held-pair projections, median cosine >0.1).
Otherwise stop this neural arm and prioritize the procedure control. If
warranted, choose a layer only on old paired evidence and test at most two
small rank-one corrections plus a norm-matched seeded random correction.
Use a centered input-binding direction and an output-binding direction, so
opposite source subjects receive opposite corrections rather than a global
write-less or case bias. No gradients, optimizers, or whole-model dequantization.

## Generation / procedure control

Compare unchanged 4B with an evidence-first JSON procedure that MUST emit
`subject_turn`, `subject_quote`, and `value_quote` before selecting `object_id`.
These are actual generated intermediate fields, not extra reminder text.
The usual app parser reads the final events; there is no new deletion filter
or extra model call. Validate source fields and item/value bindings separately.
Native continuation margins alone never count as an extraction improvement.

Score actual generated output against frozen source labels: supported target
found, wrong-component/value writes, null/unresolved/omission on untracked
targets, unrelated correct decisions retained, invalid IDs, fabricated quotes,
malformed replies, tokens, wall time and MLX/RSS memory. Do not award credit
for hallucinations matching coarse gold windows or final answers.

Run the supplied chronology contracts with real extraction: both real changes
at their `turn.start` claim times; rare explicit final change after repeated
recaps; repeated unchanged recaps count as zero changes. Preserve all first-
round outputs. A candidate needs improved source-correct bindings without lost
supported decisions/null controls or a chronology failure. A small diagnostic
win only warrants broader development screening, never a final-validation claim.

## Resources / integrity

All model commands use the shared `run-exclusive.py`; max ~450 seconds per
lease, fresh KV/recurrent caches for every scored continuation/generation and
every adapter change, MLX allocator cache 256 MiB. Only cached pinned 4B
`32f3e8ecf65426fc3306969496342d504bfa13f3`. No other model agents, uploads,
shipping/default/shared-weight edits, or status polling. Writes only here or
the assigned scratch `weight-edit-attribution/round2` directory. Result keys
include exact procedure/intervention hashes, model revision and full prompt.

## Amendments

Append-only and state whether model results had already been observed.

- Before model calls: require the >=2 native errors to occur in the OLD-DEV
  dual-tracked cases used to construct the binding direction. Null-only
  registry failures do not justify strengthening a case-versus-button axis.
  Also require centered input direction >=6/8 correct held-out subject signs;
  otherwise the proposed linear correction could become a global subject bias.
- After native and first generation results (frozen in `04a1b5df5`): the
  correct component wins all 8 OLD dual-tracked full-sequence rankings, while
  all 4 OLD untracked-property prefixes incorrectly choose the case slot.
  No weight edit is warranted for the already-correct identity signal. The
  evidence-field procedure loses recall (28→20 of 38 source-labelled events).
  Deepen only the evidenced registry-boundary mechanism: add a domain-neutral
  string abstention marker `__untracked__` as an explicit choice, translating
  only that exact object_id to JSON null. The native JSON procedure otherwise
  stays unchanged; there is no added model call, guessed fact or citation
  repair. This tests a registry/NULL-representation failure, not a global
  write-less direction. First screen the 12 OLD controlled cases covering
  all four untracked-property cases, four tracked case controls and four
  tracked button controls. Expand to the frozen remaining cases only if it
  reduces wrong writes without losing any source-supported events. No labels
  or first-round artifacts change.
- After the 12-case OLD sentinel screen: generic `__untracked__` gives the
  same 12/14 found bindings and two wrong writes as native generation on those
  cases, so it is rejected without NEW screening. Native dual-registry
  generation already supplies positive evidence for a narrower procedure:
  specific component labels route the OLD mistaken writes correctly. Test
  a fixed, extraction-only shadow vocabulary: button material and enter-button
  curve counterparts of case_material/case_curve, with the same allowed values.
  Add a shadow only when that property is not genuinely registered (including
  the real IS1008 button_material alias). Present shadows as ordinary extraction
  choices, then project only their IDs to null before the actual registry can
  write anything. This is domain-specific schema augmentation, not a generic
  component-discovery system, learned direction, or new fact. Apply the same
  fixed rule to every case without reading its expected label. OLD 12-case gate
  remains: fewer wrong writes, no source-recall loss; only then run the rest
  of the frozen fixtures and chronology contracts. No additional model calls
  per extraction request. This is evidence-motivated deepening after the
  initial small screen, not a new held-out validation.
- The shadow rule passes the OLD gate: wrong writes 2→0 with all 12 previously
  found bindings retained. Expand to all frozen fixtures. Add prospective
  material-domain chronology tests (frozen by `shadow_contracts.py` before its
  calls) because the original budget/vendor fixtures do not activate this
  domain-specific shadow rule: two case-material changes, old material recaps
  before a rare final change, unchanged case with a later untracked button
  decision, and retention of an actually registered button-material decision.
- After the frozen remaining-case screen: shadow vocabulary keeps all
  previously found source bindings, gains one source-backed binding, and
  reduces wrong writes on NEW fixtures (4→3). Test transfer on four ORIGINAL
  cached full windows: ES2003b enter-button curve, ES2003c accepted lithium /
  curve / rubber controls, TS3004c rubber-button error, and TS3004c's accepted
  hard-plastic case decision with its weak/pronominal quote. No synthetic
  rewrite. Freeze these focus outcomes in `full_window.py` before calls and
  replay only those replacements open loop. This is further development
  screening, never final validation or a closed-loop full-dev claim.
- Final source audit / terminal decision: all six targeted full-window focus
  checks and all active-domain chronology checks pass, but current-value QA
  remains 28/43. The sole QA gain is a change-count answer, and four newly
  produced/anchored off-target assertions lack source support (two happen to
  agree with gold values). No procedure qualifies for promotion/validation.
  Conclude the bounded path without adding shadows or tuning on these checks.
  Recovery/finalization uses completed artifacts only; no new model calls,
  production-baseline substitutions, or reserved-247 generation/scoring.
