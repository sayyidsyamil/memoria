# Targeted repair of Qwen3.5-4B JSON loops

**Closed bounded study — no qualified deployment or final-247-validation candidate.**
The final static edit terminates the **derivation** loop naturally, but its independent
dev/recovery/cross-task gates were not run before the requested closeout. The stopping
prototypes have real event-loss counterexamples. All modules here remain research-only.

Model: `mlx-community/Qwen3.5-4B-MLX-4bit` at
`32f3e8ecf65426fc3306969496342d504bfa13f3`; thinking off, greedy, extraction budget 1,800.
Historical engine/harness baseline: `225f709fd27779103ea6dc01058776528a74af4b`.

## Final static result: a derivation-only lead

Actual free generation on **TS3004b.w0 only**; no online stopping or supplied closure:

| Arm | Output tokens | Natural EOS / raw clean JSON | Result |
|---|---:|---|---|
| Unchanged 4B | 1,800 | No / No | Repeated unresolved event to cap |
| Layer 30 contrast, strengths 0.5/1/2/6 | 1,800 | No / No | Negative |
| Layer 30 sparse64, strength 6 | 1,800 | No / No | Negative |
| Matched random-output layer 30 controls | 1,800 | No / No | Negative |
| **Final layer 31 structural edit, strength 2** | **149** | **Yes / Yes** | **8.558 s; derivation only** |
| **Final layer 31 structural edit, strength 4** | **149** | **Yes / Yes** | **8.196 s; derivation only** |
| Same-input/norm-matched random-output layer 31 control, strength 4 | 1,800 | No / No | 61.556 s; baseline bytes |

The final edit emits two identical unresolved objects and then natural EOS. Its sole
unique parsed event is preserved; there were **zero valid grounded candidates** in
the original looping reply, and no gold extraction gain is shown. These training-case
timings are not an interleaved base/edit or population-p95 comparison.

The derivation normal, TS3004b.w1, stays byte-identical at 58 tokens. Its entire prefix
was algebraically protected when constructing this final direction, so this is **not
independent preservation evidence**. No weight edit completed independent-loop, all-normal,
repeat-then-new-event, Ask/guard or whole-pipeline qualification. No candidate advances.
Layer 30 strength 2's full normal generation was deferred by its lease; its causal normal
prefix was checked separately. Unexecuted configs are not results.

## First decisive measurements

Nine frozen development windows: two literal repetition failures, one distinct-event
enumeration overrun, and six nonempty normal controls. All nine fresh baseline outputs
match the historical coordinator cache **byte for byte**.

| Actual inference, same 9 prompts | Repetitive caps | All caps | Returned unclean | Tokens | Generation s | Diagnostic p95 s | Normal byte equality |
|---|---:|---:|---:|---:|---:|---:|---:|
| Unchanged 4B | 2 | 3 | 3 | 9,058 | 321.27 | 65.54 | 6/6 |
| Stop at first completed exact duplicate | 0 | 1 | 1 | 6,670 | 308.92 | 72.05 | 6/6 |

These are real online timings, including detector/iterator shutdown. The first-repeat
rule stops the two loops at 147 and 1,065 emitted tokens; the remaining capped reply
contains **distinct** events and remains unchanged. This first timing pair **does not
show a p95 win**: unaffected outputs ran more slowly in the second lease. Interleaved
controls are required before attributing a latency change to an intervention.

First-repeat stopping also fails the required recovery control `[A,A,B]`: it discards
the distinct correct event B. Its apparently perfect preservation on these 97 cached
windows is insufficient for recommending a general stopping rule. Actual generated
recovery controls confirm this failure (below).

## Conservative stopping: measured benefit, failed general recovery

Actual adjacent base/conservative generations, alternating AB/BA order within one lease:

| Exact affected case | Base tokens / s | Conservative tokens / s | Returned completion |
|---|---:|---:|---|
| TS3004b.w0, literal loop | 1,800 / 49.834 | 291 / 11.867 | Rule stop + supplied `]}` |
| TS3006d.w0, alternating-event loop | 1,800 / 55.637 | 1,195 / 36.301 | Rule stop + supplied `]}` |
| TS3006d.w3, distinct-event enumeration cap | 1,800 / 55.223 | 1,800 / 52.287 | Same capped bytes |
| TS3004b.w1, normal extraction | 58 / 6.328 | 58 / 5.775 | Same natural-EOS bytes |

Four-prompt total **167.022→106.229 s**; p95 **55.575→49.889 s**. This is an enriched
four-case diagnostic, not full-development population p95. The unaffected controls
also ran somewhat faster, so the exact saving should not be extrapolated.

**Recovery failures prevent deployment:**

- Fully model-generated strict-root `[A,A,B]` control, with a later correct LCD event:
  base 247 tokens/9.545 s; first-repeat 163/7.015 s **loses B**; conservative 247/9.434 s keeps B.
- A forced-prefix extraction also recovers a correct TV-only event after a duplicate;
  first-repeat stopping loses it. Earlier unsuccessful control construction attempts
  are retained in `recovery-base.*`.
- A constructed stream of **four unresolved repeats followed by a distinct, real-source
  grounded LCD event** makes the conservative rule lose that event. This is an algorithmic
  counterexample, not a claim about its frequency in spontaneous model output.

Therefore `stop_rule.conservative()` remains **research-only**, despite its measured
latency benefit and preservation on the frozen 97 outputs.

### Preservation scope

- Full **97-window offline audit**: only the two literal loops trigger; no distinct
  valid grounded candidate or baseline gold event is removed.
- Full **closed-loop cached** replay after either stopping rule: 97 hits / 0 misses;
  TP 26/60, QA 90/124, current 28/43, wrong writes 46, review proposals 119, unchanged.
- Raw generated JSON is retained separately from the rule's added closing `]}`. The
  rule improves returned syntax; it does not turn raw truncation into natural EOS.
- Per-window `gold_hits` in diagnostic files precedes cross-window deduplication.
  It is **candidate coverage, not pipeline TP**. Grounding alone is not correctness.
- `data/preservation_anchors.json` additionally records three source-grounded late
  corrections/confirmations in TS3006d.w3. A shorter prefix can lose these despite
  losing zero sparse gold matches; helper tests explicitly demonstrate that trap.

## Weight hypotheses

Only TS3004b.w0 (loop) and TS3004b.w1 (matched normal) derive directions. Teacher forcing
uses the exact fresh-baseline token IDs, normal 2,048-token prefill, fresh recurrent/KV
caches, and has **zero greedy-token mismatches** on the observed prefixes.

All 32 MLP-down layers were observed at four positions before event closure. Layer 30
had the largest positive direct-logit attribution toward the continuation delimiter
`},{"` versus normal `}` both for loop-minus-normal and later-minus-first repetition.
This is a hypothesis for intervention, not causal evidence by itself.

| Family | Actual 4B selection | Unit-strength edit / projection Frobenius norm |
|---|---|---:|
| `contrast` | Layer 30, loop-minus-normal output direction, all 9,216 input columns | 2.878% |
| `repeat64` | Layer 30, third-minus-first repeated event direction, 64 largest contrastive neuron contributions | 1.198% |
| `structural` | Final MLP, layer 31; continuation-minus-close output axis; 512 input columns nulled on 133 derivation-control states | 1.000% |

All static arms implement `W' = W - strength * u vᵀ`. In the first two, v is projected
from the bf16-rounded dequantised matrix, optionally restricted to 64 columns. In the
last, v is an activation-derived recurrence feature. The quantised matrix stays the base matmul; a
float32 rank-one residual is added at runtime and cast back to the original output
dtype. This is a **weight-equivalent runtime edit**, not a requantised checkpoint.
Its inference overhead is included. Only one projection at a time is dequantised
when deriving a vector; the full model is never dequantised.

Seed 20261103; every exact config and vector/artifact SHA-256 is in `directions/`.
Measured random-output controls use the **same input v** and a unit random u, matching
both coefficient Frobenius norm and perturbation magnitude for every fixed input.
Other strength/opposite-sign configs are retained but only logged executions count.

### Requested nonlinear arm: rejected

The generated-token-only adapter `y' = y - alpha * relu(vᵀx-2) * u` is **nonlinear
activation steering**, not a static weight edit or checkpoint. Strengths 12/24 leave
the third repeated-boundary continuation margin at 2.000/0.8125 (base 3.625); both still
prefer another event. Strength 24 changes 27 other counterfactual token predictions.
The feature activates on 17/57 normal-prefix tokens. Both fail the preregistered causal
screen; no independent free-generation or quality success is claimed for this arm.

## Resources, data-access scope and verification

- Apple M5, 16 GiB; MLX 0.31.2, mlx-lm 0.31.3, transformers 5.8.1. Existing local 4B only.
- All 15 model jobs completed; longest 331.52 s. Maximum process footprint 4.996 GB;
  MLX peaks about 4.00 GB; allocator cache capped at 256 MiB. No resident worker retained.
- **19 CPU helper tests pass**, including tests that document recovery failures;
  passing the test suite does not mean an intervention passes its quality gates.
- Zero-strength identity, target-array immutability and single-projection numerical
  equivalence were checked on the real quantised path. fp32-reference relative L2
  differences: 0.000414/0.000193 for the layer 30 arms. No requantised checkpoint tested.
- **No new-val generation or scoring.** `audit_access.py` performs a fresh-process
  replay with directory loaders disabled and a blocking open-audit allowlist. It
  opens exactly the ten owned dev `.chain`/`.ask` files and reproduces 26 TP, 90/124 QA,
  46 wrong writes. This proves our replay path, not the coordinator's historical host
  parsing or every byte of a shared cache. No blanket project-wide unread claim.
- `frozen_source_check.json` verifies five critical engine/harness sources against
  225f709fd. Runners now refuse a mismatch before model loading. This is a critical-file
  guard, not a complete dependency lock; historical-worktree reproduction remains required.
  Newer main number-word repairs were not imported into these measurements.

## Reproduce / inspect

- [`PROTOCOL.md`](PROTOCOL.md): selection, margins, amendments and resource limits.
- [`WORKLOG.md`](WORKLOG.md): successes, failures and reasons for revisions.
- [`VERIFICATION.md`](VERIFICATION.md): final executed checks and unexecuted gates.
- `MANIFEST.json`: hashes of the completed research bundle (excluding the manifest itself).
- `data/diagnostics.json`: frozen IDs, roles, source revision and hashes.
- `data/dev_prompts.jsonl`: full reconstructed dev prompts plus original responses.
- `results/*.jsonl`: every measured prediction, actual token IDs, wall time and parse/
  grounding checks. `.meta.json` records exact runtime/config/source hashes; `.log`
  includes `/usr/bin/time -l` process footprint. `resource_audit.json` indexes all 15 jobs.
- `stop_rule.py`: standalone streaming experiment. Default first-repeat is a negative
  recovery control. `conservative()` requires three consecutive unresolved repeats;
  valid repeats never trigger it, but a longer unresolved cycle could still recover.
- `weight_patch.py`: opt-in in-memory projection wrapper with restoration callback.
- `activation_gate.py`: rejected nonlinear arm; phase reset is explicit.
- `run_recovery.py`: real JSON-copy and forced-prefix-continuation recovery controls
  based on two distinct decisions explicitly stated in TS3006b turn107. These are
  stress controls, not naturally occurring baseline extraction successes.

CPU checks (no model):

```sh
PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/bin/python3.11 -B -m unittest discover \
  -s research/weight-edit-loops -p 'test_*.py' -v
```

For an explicitly commissioned **research-only** replay, use a new label and the exclusive
wrapper below. No application integration is recommended by this study:

```sh
PYTHONDONTWRITEBYTECODE=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
  /opt/homebrew/bin/python3.11 \
  /private/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode/run-exclusive.py \
  /usr/bin/time -l /Users/Shared/Memoria/runtime/speech/bin/python -B \
  research/weight-edit-loops/run_generation.py --label NEW-LABEL --condition base
```

To inspect the final static lead, replace the final arguments with
`--label NEW-LABEL --condition edit --edit directions/structural_layer31_s2.json
--ids TS3004b.w0,TS3004b.w1`. `weight_patch.install(model, spec)` returns an undo callback;
fresh request caches and `reset_shared()` before/after a condition are required.

The runner refuses resident/user-model conflicts, caps MLX allocator cache at 256 MiB,
uses fresh request caches, resets `model_server._prefix` and `_meeting`, and exits all
weights before releasing the external lease. All changes are confined to this research
directory; the pinned shipping model files and protected engine paths remain untouched.

Reference mechanism: [Takehi et al., Weight-Space Programming](https://rikiyat.github.io/blog/weight-space-programming/).
The 0.8B vectors/layer IDs were not reused or retested. Data/harness provenance is in
the coordinator's `research/model-improvements/PROTOCOL.md` and this bundle's frozen hashes.
