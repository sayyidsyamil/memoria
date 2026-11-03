# Work log

Newest last. Each entry: what was tried, on which split, the result, and what was rejected and why.

## 3 November 2026

- 12:10 Protocol written and committed before any new model result (`PROTOCOL.md`). Read: the Weight-Space
  Programming post, `exp8_math/README.md`, the model card; Memoria's `model_server.py`, `temporal_service.py`,
  `live_guard.py`, `qwen_scoring.py`, the engine's extractor, windows, pipeline, metrics and router; the research
  READMEs (strong-model, firmness-gate, local-9b, model-bakeoff, live-verifier, app-parity, long-meeting).
- From the October caches (no model): 5 of 144 extraction replies (3.5%) ran to the 900-token limit, all repeating
  one event or one sentence until cut off (a repetition loop, thinking off); these 5 are exactly the replies that did
  not parse cleanly (their earlier events are salvaged one by one by `parse_events`).
