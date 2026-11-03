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
