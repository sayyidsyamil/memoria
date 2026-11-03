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
- 12:20 Harness (`harness.py`, `lm.py`, `score.py`): the app's tracked-fact extraction reproduced in-process. Checks:
  October's own replies through it give October's numbers exactly (`check_harness.py october`: old-dev TP 15, FP 58,
  FN 8, QA 35/45; old-test TP 31, FP 116, FN 15, QA 59/96); the in-process requests give byte-identical replies and
  first-token scores to the app's `model_server.py` worker on six requests (`run.py parity`, one lease, 4B).
- 12:22 Edited 0.8B verified (`wsp.py`): the published p50c diff applied to stock Qwen3.5-0.8B @ 2fc0636 gives both
  tensors with the model card's SHA-256; the released checkpoint @ d1671a1 (streamed, not stored) has the same 488
  tensors, and only those two differ; config, tokenizer, chat template, vocab and merges are byte-identical. What the
  edit does, read from the tensors: in each of layers 15 and 19, for 64 of the 3,584 MLP neurons, the component of the
  neuron's output along one direction is multiplied by -5 (W' = W - 6 u u^T W on those columns; rank-1 share 0.99999;
  the rest of each column unchanged up to bf16 rounding). It "counteracts" the direction rather than removing it.
  It survives 4-bit affine quantisation (group 64): the quantised difference has cosine 0.96 / 0.94 with the bf16
  edit, and the edited columns' projection on the direction is unchanged (0.153 -> 0.152; 0.120 -> 0.119).
- October dev replies, audited (`audit.py october october old-dev`): of 73 writes, 15 are gold events, 39 restate the
  value in force (harmless), 18 write another value and 1 a value before any was decided. About half of those 19
  cite a turn that names neither the item nor the value ("Then we do it." -> teletext excluded; "Unfortunately we
  require the advanced chip" -> LCD excluded and price 1.5; "Yeah, and single curved curved." -> remote type); the
  rest are suggestions or colour talk before the decision. Hypothesis for a mechanism: an attribution (support)
  check, not a firmness check. Its question was written (`support.py`) before reading any app-path output.
- 12:55 No-model filters on October's dev replies (illustration only; the app path differs), open loop, against
  random removal of the same number of writes per meeting (`controls.py`, 300 draws):
  - `lastvalue` (within a meeting, a slot keeps only writes of the value its last write states): removes 8 writes;
    QA with exact routes 35 -> 39 of 45 (changes 10 -> 14 of 16); gold events kept 15 of 15; wrong writes 19 -> 14.
    Random removal of 8: QA mean 35.2, 90th percentile 36; gold kept 13.9. Passes the protocol's filter rule.
  - `lexsupport` (keep a write only if its turn or the one before names a word of the item or the value): removes 23;
    QA 36 (random mean 35.1, 90th percentile 36), gold kept 14 (random 12.7), wrong writes 19 -> 9. Marginal on QA.
  To be rerun on the app path (old-dev + new-dev) before any conclusion.
- 13:00 4B through the app path on old-dev (ES2003, TS3004; 41 windows, 451 s of generation; 1 reply hit the 1,800-token
  budget and did not parse cleanly): TP 13, FP 53, FN 10; QA with exact routes **27/45**, against October's request
  (same model, same prompt, no system message, 900 tokens, no repairs) at 35/45 on the same questions: 0 questions
  only the app gets right, 8 only October gets right (exact sign test p = 0.008). Wrong writes 24 against 19; the
  confirm_all inbox 52 proposals against 41. Two causes found so far:
  1. `temporal_service.repaired` drops an amount whose quote spells the number out ("twelve point five Euros per
     unit", "sell them for twenty five"): ES2003a's production cost and price are read correctly and then dropped.
     Keeping amounts that the quote states in words (never replacing a value with one) restores both: QA 29/45.
  2. The rest is the request: the worker's system message ("Follow the requested JSON structure exactly. Return JSON
     only. Use only the supplied evidence...") is the remaining difference from October's request apart from the
     budget (1,800 against 900 tokens, which changes only replies that run that long). Hypothesis H-sys: the system
     message makes the 4B write more, and more wrong, events. To be tested closed loop on old-dev and new-dev
     (`app-nosys`), since October's replies exist only for old-dev and with 900 tokens.
- Filters on the app path, old-dev, open loop: `lastvalue` QA 27 -> 33 but gold events 13 -> 10 (it keeps a late
  remark over the decision: ES2003d "I'd say we go two... double curved" after single curved was decided);
  `lexsupport` QA 30, gold 12, wrong writes 24 -> 14. Random-removal controls pending the full dev set.
