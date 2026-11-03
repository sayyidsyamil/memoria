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
