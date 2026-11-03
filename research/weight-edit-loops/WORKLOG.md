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
