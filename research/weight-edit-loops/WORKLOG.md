# Work log

## 2026-11-03 — preparation

- Read the worktree AGENTS.md and coordinator protocol/worklog/README plus lm.py,
  harness.py, score.py, run.py, check_harness.py. The app extraction request is
  reproduced by the coordinator; its six-request real-worker parity is historical,
  not a new verification claim from this branch.
- Baseline snapshot source is the assigned worktree at `225f709fd27779103ea6dc01058776528a74af4b`.
  Its 4B cache SHA-256 is `e2d7f6eecf960f69f4399ab3b30749c95a7ac683ce8ae76c0095b61fb3a968a9`.
- Initial audit corrects an important distinction: TS3004b is a repeated unresolved
  event; TS3006d's early window eventually alternates two identical unresolved events;
  TS3006d's late window runs to the cap while enumerating different turns/events.
  The latter has no exact duplicate. All three are kept in the diagnostic.
- Read the actual installed MLX Qwen3.5 implementation: dense SwiGLU MLPs feed quantised
  `down_proj`; recurrent GatedDeltaNet and attention caches require fresh state.

## 15:40 — actual baseline and offline preservation controls

- `baseline-r1`: all nine actual 4-bit MLX outputs are **byte-identical** to the frozen
  historical responses. Generation total 321.27 s; caps 3/9, exact repetitive caps 2/9.
  The process lease was 331.52 s; peak MLX allocation 3.989 GB and process footprint
  4.980 GB. Installed versions: MLX 0.31.2, mlx-lm 0.31.3, transformers 5.8.1.
- The online stop job is now separate actual inference, not cached/simulated timing.
- CPU audit: exact-completed-event stopping triggers only on TS3004b.w0 and
  TS3006d.w0 in all 97 dev windows; loses no distinct valid grounded candidate and
  no baseline gold match. Both stopped outputs consist entirely of unresolved events.
- Full **closed-loop cached** replay after stopping: 97/97 request cache hits, zero
  misses (beliefs/prompts unchanged); TP 26/60, QA 90/124, current 28/43, wrong writes
  46, review proposals 119, all identical to baseline. Returned unclean replies 3→1
  due to explicit JSON closure. Raw stopping remains distinguishable from natural EOS.
- Important measurement distinction: per-window gold candidate coverage is computed
  *before* the app's cross-window deduplication. It is not full-pipeline TP; the
  summary script and later tables keep this distinction explicit.
- Eight CPU helper tests passed, including arbitrary stream chunk boundaries, escaped
  braces/quotes, distinct decisions from one quote, partial JSON, and dev-only loading.
- Cross-task probes frozen before edited-model output: six synthetic guard cases,
  three synthetic live Ask cases, four real development router questions. These are
  narrow smoke probes, not a population benchmark.

## 16:07 — first weight screen, negative

- `contrast-screen`: zero, 0.5, 1 and 2 strengths all produce the exact same
  1,800-token unresolved loop on TS3004b.w0. Matched normal TS3004b.w1 is unchanged
  at zero/0.5/1. Strength2's normal was explicitly deferred by the bounded lease.
  No success is claimed; each prediction and its condition are retained.
- Lease: 326.89 s, MLX peak <=4.000 GB, process peak footprint 4.977 GB. Model
  caches were new for each request and both shared worker caches cleared.
- The saved activation geometry predicts a growing positive contrast projection
  at successive loop boundaries (0.044, 3.744, 5.280) but a negative projection on
  the normal boundary (-3.749), so stronger global removal could hurt normal
  stopping. Fixed-prefix causal probes will test this before more long decodes.
- Random projection controls are matched in weight norm. A further control using
  the *same* learned input vector v and a random output u will also match the
  perturbation's activation magnitude exactly, isolating output-direction effects.

## Later static screens and recovery controls

- Contrast strength6 changes some loop text but still exhausts1800 tokens; its
  activation/norm-matched random-output control does too. Matched normal remains
  byte-identical. The sparse64 strength6 output is exactly the original1800-token
  loop; its random-output control also caps. These are negative results, not wins.
- Fixed-prefix causal screen: contrast strength6 lowers the third-boundary
  continuation-minus-close margin3.625→2.125, insufficient to choose closure. The
  sparse64 edit hardly changes the margin (3.625→3.375). All fresh-state evidence
  remains in `causal-grid.*`.
- Fully generated strict-root recovery control: base247 tokens/9.545s preserves the
  correct later LCD event; first-repeat163/7.015s discards it; conservative247/9.434s
  preserves it. Earlier copy control wrapped its output in an outer array (detector
  declines it); that attempt is retained. Forced-prefix extraction independently
  recovers a correct TV-only event after the duplicate, also lost by first-repeat.
- Numerical verification: zero-strength identity and unchanged quantised target
  arrays pass. Against a single-matrix materialisation using fp32 dequantisation,
  relative L2 differences are0.000414 (contrast) and0.000193 (sparse), reflecting
  arithmetic/rounding differences; no exact finite-precision equivalence is claimed.
- Interleaved conservative stopping, four diagnostic prompts (three caps plus the
  matched normal): loop calls49.834→11.867s and55.637→36.301s, with291/1195 emitted
  tokens; enumeration and normal remain byte-identical. All eight requests finish
  in one285.67s lease; peak process footprint4.769GB. This is a small enriched
  diagnostic, not a full-development p95 estimate.
- Prepared but **not run**: `derive_structural.py`, a last-MLP recurrence-input feature
  writing against a structural continuation axis. Coordinator's rectified-gate arm
  takes priority over that optional third static hypothesis.

## Rectified gate — stopped at the preregistered derivation screen

- Nonlinear, generated-token-only ReLU(phi-2) gate with strengths12/24; the same
  phi/gate/amplitude with a unit-random output vector is its control. The entire
  prompt prefill and first output-token prediction were unsteered.
- Base phi>2 on179/218 loop-prefix tokens and17/57 normal-prefix tokens, so the
  apparent separation at event closure is not a globally loop-specific feature.
- Third repeated-boundary continuation margin: base3.625; gate12=2.000;
  gate24=0.8125; random-output24=3.5625. All still select continuation. Gate24 also
  changes27 earlier greedy predictions, mainly quote/schema positions, without
  reaching the clean-closure target. Derivation normal remains unchanged.
- The predeclared criterion rejects both variants. No free-generation speed,
  independent-loop, Ask/guard or recovery success is claimed for these gates.
  Source/config/evidence is preserved in `gate-causal.*` and `directions/gate*`.
- Proceeding to the final preplanned static structural-output alternative, then
  finish with either a controlled candidate or the bounded negative result.

## Final static check and closeout

- Last-MLP (layer31) static rank-one structural edit,512 input columns. The recurrence
  input direction retains40.4% of contrast after nulling133 derivation-control states;
  protected feature magnitude is below1e-5. This is a closed-form weight edit, not
  the rejected nonlinear gate and not a new architecture or trained optimizer.
- Actual free TS3004b.w0 generation: strength2 and4 both finish at **149 tokens with
  natural EOS and clean raw JSON**, in8.558/8.196s. The same-input, equal-norm random
  output direction at strength4 runs to1800 tokens/61.556s, exactly the baseline text.
  Both edited outputs retain two copies of the original unresolved event; no unique
  parsed candidate is lost and there were no valid grounded candidates or gold hits
  to begin with. This shows a derivation-case mechanical effect, not an accuracy gain.
- TS3004b.w1 remains exactly58 tokens under both edits and the control, but this is
  the algebraically protected derivation normal. It is not independent validation.
- User closeout instruction: complete this running check, conclude the bounded study,
  do not widen search. All remaining checks are CPU tests/audits/hashes. Independent
  dev, recovery and cross-task evaluation of the final structural edit is **not run**;
  consequently no candidate qualifies or enters final247 validation.
- Conservative stopping is also research-only: a new constructed stream using the
  actual source-grounded speech/LCD events at TS3006b turn107 proves that four
  unresolved repeats followed by a distinct correct LCD event loses that later event.
  This is an algorithmic recovery counterexample, not a naturally generated frequency
  estimate. The fully generated strict-root control already rejects first-repeat.
- All15 model jobs completed, longest331.52s; peak process footprint4.9955GB. No owned
  model process remains. Final CPU helper suite: **19 passed** (includes expected
  failure/counterexample tests, not successful candidate quality gates).
- Fresh-process source-access audit disables both coordinator directory-loader
  entrypoints, blocks unapproved dataset opens, and records exactly10 dev `.chain`/
  `.ask` files. It reproduces the original97 requests and26 TP/90 QA/46 wrong writes.
  This verifies our exact-file path, not the coordinator's historical host parsing.
- Five critical engine/harness source hashes match225f709fd. Runners now reject a
  mismatch before loading a model, preventing silent main-repair mixing on those
  critical files; full historical dependency pinning remains the coordinator's scope.

**Final qualification outcome: negative — no deployment/validation candidate.** A
derivation-only structural-edit lead and all negative/control evidence are preserved.

- Final EOS audit initially made a wrong single-ID assumption from text_config
  (248044). The recorded terminal ID is248046, the tokenizer's `<|im_end|>` EOS.
  Cached tokenizer metadata resolves this; both149-token replies have genuine chat
  EOS, no early-stop flag and no supplied closing syntax. This was an audit
  assumption error, not a generation failure; the correction is retained in
  `eos_token_audit.json` and reproducible with `audit_eos.py`.
