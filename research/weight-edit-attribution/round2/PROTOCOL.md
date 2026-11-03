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
