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
- 12:12–12:18 Gold for new-dev (ES2011, IS1008, TS3006: 37 events, 79 questions) and new-val (8 series: 106 events,
  247 questions) built with October's unchanged `build_chains.py` from the pinned AMI annotations (`build_gold.py`;
  October's 7 chains rebuild byte-identically from the same annotations). Slot rules are in `specs_new.py` (rule 7 was
  added while drafting new-val, before any model output). Evidence turns: new-val 92 of 106 events through the human
  links, 4 within 45 s of them, 10 by best word overlap (October: 63, 2 and 4 of 69). `data/manifest.json` hashes the
  specs, the builder, the annotations and every built file; frozen and committed before any model reads these series.
