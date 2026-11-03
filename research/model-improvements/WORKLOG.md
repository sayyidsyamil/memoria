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
- 13:16 4B app path, full dev (old-dev + new-dev: 20 meetings, 97 windows, 60 gold events, 124 questions):
  TP 26, FP 130, FN 34 (recall 43%); QA with exact routes 90/124; 156 writes reach the ledger, of which 26 are gold
  events, 84 restate the value in force (often from another turn than the gold evidence: on ES2011 the model found
  six of nine decisions with the right value but outside the human-linked windows, so TP 0 there), and 46 write a
  value not in force (wrong). confirm_all inbox: 119 proposals (5.95 per meeting), 25 of them exact gold events;
  QA after a perfect reviewer 92/124. Mechanical: 3 of 97 replies ran to 1,800 tokens repeating themselves and did
  not parse cleanly; median meeting 54 s of generation (mean 57.6 s). Routing (router prompt r1 through the
  worker): 100/124 exact, 0 failed, 124/124 right on gold facts, 2.8 s median.
- Dev screening, open loop (filters on the app's own candidates; QA, gold events found, wrong writes, inbox):
  | mechanism | QA /124 | gold found /60 | wrong | inbox |
  |---|---|---|---|---|
  | app | 90 | 26 | 46 | 119 |
  | numwords | 93 | 29 | 46 | 122 |
  | lastvalue | 97 | 20 | 35 | 95 |
  | numwords + lastvalue | 100 | 23 | 35 | 98 |
  | lexsupport | 92 | 24 | 28 | 84 |
  | loopstop | 90 | 26 | 46 | 119 (meeting 57.6 -> 54.3 s) |
  **lastvalue rejected**: it loses 6 gold events (guardrail: at most 2), because the last value a meeting mentions is
  often a later remark after the decision (evaluation, recap of the prototype), not the decision; its QA gain comes
  from writing fewer changes, which the change-count questions reward whatever is removed.
- 13:45 **H-sys, closed loop on full dev** (`app-nosys`: the worker's request without its JSON system message, 1,800
  tokens, the app's repairs): QA 95/124 against 90 (12 questions only nosys gets right, 7 only the app; sign test
  p = 0.36), gold events 29 against 26, wrong writes 45 against 46, confirm_all inbox 100 against 119 proposals,
  QA after a perfect reviewer 97 against 92. Per series: ES2003 +3, TS3004 +5, TS3006 +1, ES2011 -3, IS1008 -1, so
  the dev gain rests mostly on old-dev. Why: without the system message the 4B marks far more events unresolved or
  with a null item (ES2003: 37 unresolved of 93 events against 9 of 49), which the pipeline discards; it writes
  fewer belief changes. Cost: replies are longer (ES2003 5,847 output tokens against 3,300; one loop to 1,800
  tokens), so generation takes 16% longer per meeting (67 against 58 s); stopping a reply at its first repeated
  event (`loopstop`, simulated on the cached replies) brings that to +7%.
- **Support check rejected** (`support.py`, first-token YES/NO on attribution, open loop on the app's candidates):
  tau = 0 removes 76 writes, wrong writes 46 -> 27, inbox 119 -> 80, but QA 90 -> 87 and gold events 26 -> 23: it
  drops the only write of several slots whose value was right but whose quote was weak (current-value questions
  28 -> 23 of 43). tau = -2 removes almost nothing; tau = 2 removes nearly everything (QA 78). Like the firmness gate,
  precision rises and answers do not.
- **lexsupport rejected on QA**: its QA 92 is inside random removal of the same 49 writes (mean 90.9, 90th percentile
  94; 39% of draws reach 92), although it keeps more gold events than random removal (24 against 20.1).
- 14:00 More no-model screening on dev (open loop; random removal of the same number of writes per meeting, 300 draws):
  - Random removal alone raises QA (app base: 21 writes removed at random -> mean 92.8 of 124 from 90): the
    change-count questions reward any thinning, so every filter below is read against its own random control.
  - `support-changes>=0` (the support question asked only of writes that would change the value in force): QA 90
    unchanged, gold 26 unchanged, inbox 119 -> 107. No QA effect; not pursued.
  - `reanchor:k` (a write whose turn and the one before name neither item nor value moves to the nearest turn within
    k that does, else it is dropped): k = 10 gives QA 95, gold 27, wrong 36, inbox 103; random removal of the same 21
    writes: mean 92.8, 90th percentile 95 (15% of draws reach 95). At the edge of the rule; k = 3 fails it.
  - `modevalue` (within a meeting, a slot keeps the value written most often, ties to the later): on the app base QA
    98 but gold events 26 -> 21 (fails the guardrail and keeps fewer gold events than random removal, 22.7). On the
    nosys base QA 95 -> **102**, gold 29 -> 28, wrong writes 45 -> 28, inbox 100 -> 84; random removal of the same 21
    writes: mean 95.4, 90th percentile 98, 0.3% of draws reach 102; gold kept 28 against 26.3. Passes. `lastvalue` on
    the nosys base: QA 100, gold 27 (passes, 1.3% of draws reach 100). Why the base matters is not established; a
    plausible reading is that without the system message fewer wrong values are repeated, so the commonest value in a
    meeting is more often the decided one. Selection bias: modevalue is the second variant of family (2) tried after
    lastvalue failed on the app base; the dev number is optimistic.
  - Next: closed loop on dev for `app-nosys-numwords-loopstop+modevalue` (its own beliefs in later prompts).
- 14:10 **0.8B, first results (dev; bf16; same requests as the app, thinking off, greedy).**
  - Guard (MemoriaBench dev, 20 conflicts / 40 must-not-alert, lexical candidates): stock and edited both catch 0/20
    with 0/40 false alarms at the shipped threshold 2.0: no first-token log-odds reaches 2. Strongest-candidate AUROC
    0.629 (stock) and 0.632 (edited), near chance; at threshold 0, stock 14/20 with 20/40 false alarms, edited 20/20
    with 24/40. Unusable as the guard at any threshold. 0.05 s per question (the 4B reference run is queued).
  - Routing (124 dev questions): right on gold facts 4B 124, edited 103, stock 95; exact routes 100 / 93 / 85;
    replies that did not parse 0 / 10 / 15; median 2.8 / 0.9 / 0.95 s. Edited against stock: 9 questions only the
    edited model routes right, 1 only stock (p = 0.021). 4B against edited: 21 against 0.
  - Extraction, ES2003 (20 windows): stock 0.8B ran **12 of 20** replies to the 1,800-token budget (repetition loops,
    thinking off) and took 542 s; the edited 0.8B ran 3 of 20 to the budget and took 193 s. The edit's loop fix carries
    over to thinking-off JSON generation. Quality of the extracted events is scored once all series are done.
  - Memory: MLX active after load 1.56 GB (bf16) against 2.50 GB for the 4B (4-bit); process peak footprint over the
    suite 3.49 GB against 4.5-4.9 GB for 4B extraction jobs.
- 14:25 **Calibration of the QA metric (no model): an empty ledger answers 69 of the 124 dev questions right** (old-dev
  24/45, new-dev 45/79) and 58/96 on old-test (October's ledger: 59/96). The "as of a date" questions mostly ask about a
  date before the decision (gold: none) and most change counts are 0, so writing less is rewarded on two of the three
  question types; only the current-value questions (43 on dev) need extraction to be right. Consequences: QA gains from
  thinning are expected (hence the random-removal controls and the gold-events guardrail), and results are reported by
  question type, with current values and change counts separately. The edited 0.8B on TS3004 shows it: it writes
  almost nothing (73 unresolved and 50 invalid candidates) and scores QA 16/20 against the 4B's 10/20, with 3 of 10
  gold events against 6.
- 15:10 **Closed loop on full dev** (each configuration's own beliefs in its later prompts):
  | configuration | QA /124 | current /43 | changes /43 | gold found /60 | wrong | inbox | gen s / meeting |
  |---|---|---|---|---|---|---|---|
  | app (shipped) | 90 | 28 | 26 | 26 | 46 | 119 | 57.6 |
  | nosys | 95 | 27 | 31 | 29 | 45 | 100 | 67.1 |
  | nosys + numwords + loopstop | 90 | 25 | 28 | 29 | 53 | 104 | 65.3 |
  | **A = nosys + numwords + loopstop + modevalue** | **100** | 28 | 35 | 28 | 31 | 89 | 67.1 |
  A against the app: 17 questions only A gets right, 7 only the app (p = 0.064, dev, after choosing among variants).
  Guardrails on dev: gold found 28 >= 24, correct proposals 27 >= 23, wrong writes 31 <= 46, unclean 4 <= 4, current
  28 >= 26: all hold. Lesson about noise: nosys + numwords + loopstop differs from nosys only where amounts in words
  change a later prompt, yet QA moves 95 -> 90 (TS3006 26 -> 23, TS3004 15 -> 13). Greedy decoding of a changed prompt
  moves single-series QA by several questions, so the request change alone (nosys) is not shown to help; the robust
  part of A on dev is one value per slot per meeting on top of the request without the system message.
- Model consolidation (`consolidate`, thinking off, 16 questions on dev, 28 s in all): on the nosys base QA 101, gold
  27 (no better than modevalue: 102, 28); on the app base QA 102 with current 32/43 but gold 23 and correct proposals 22
  (fails both guardrails). Not preferred (ties go to fewer model calls).
- 15:16 Guard reference, 4B in-process (lexical candidates, threshold 2.0): 16/20 caught, 2/40 false alarms, the
  numbers `../live-verifier` published for "guard alone, threshold 2.0" on this split (an independent parity check of
  the harness); strongest-candidate AUROC 0.969; 0.33 s per question. 0.8B AUROC: stock 0.629 / edited 0.632 (bf16),
  0.619 / 0.620 (4-bit). Routing in 4-bit 0.8B collapses (51 and 54 of 124 replies unparsable; 52 and 53 right on
  gold facts against 95 and 103 in bf16).
- 15:22-15:31 **Steering from the user (via the parent): narrow scope.** Cancelled the queued and in-flight 0.8B jobs
  (one 0.8B 4-bit extraction stopped mid-series; its finished windows stay cached) and both thinking-on math checks
  (never run). Protocol amended before any new result (new-val reserved, specialists' families recorded). Candidate A
  frozen with hashes (`results/validation/candidate-A.json`), not preregistered. Demo regression, one short lease per
  configuration: shipped path and A identical (14/18 gold events, 19/21 QA, no wrong value, 12 of 13 proposals
  correct). Consolidation with thinking on: 13 of 16 questions ran out of the 1,024-token thinking budget, 552 s in
  all, QA 95: rejected. README rewritten as the intermediate deliverable; every table regenerates from the caches
  (`dev_tables.py`, `small_tables.py`). No change to `src-tauri/` or `research/ledger-engine/` on this branch.
- 15:36 **Product-contract review of candidate A** (parent's request; no model, no new-val, A unchanged). The engine keeps
  chronology inside a meeting (`Pipeline._commit`: claim time = meeting start + turn start, commits in turn order, each
  write compared with the belief in force at that moment). Fixtures through the real `Pipeline` (immediate policy),
  candidates injected, A's rule applied exactly as in A's closed loop (`harness._Gated`, `modevalue`):
  | fixture | shipped | A (commonest value) | last value | R (revert only) |
  |---|---|---|---|---|
  | 1. two approved changes in one meeting, 250k -> 280k -> 300k | 2 changes, 300k | **1 change (280k lost)**, 300k | 1 change (280k lost), 300k | 2 changes, 300k |
  | 2. "Alpha" restated 3 times, then "switch the vendor to Beta" | Beta, 1 change | **Alpha, 0 changes (decision lost)** | Beta, 1 change | Beta, 1 change |
  | 3. "still Alpha" said 4 times | Alpha, 0 changes | Alpha, 0 changes | Alpha, 0 changes | Alpha, 0 changes |
  A fails 1 and 2 (recorded as expected failures, the fixtures unchanged). Fixture 2 is a correctness failure, not a
  granularity choice: a majority of recap mentions outvotes an explicit later decision and the ledger keeps the old
  value. The shipped engine already handles fixture 3 (restatements are reconfirmations, never changes).
- Rule R (`revertonly.py`, new identity, written after the fixtures, not frozen): within a meeting, drop a change only if
  the same meeting returns to the value in force before it. It passes all three fixtures, but on dev (open loop) it
  keeps almost none of A's gain: app base QA 93 with gold 23 (fails the gold guardrail); nosys base QA 96, gold 28;
  nosys+numwords+loopstop base QA 90, gold 27. **A's dev gain therefore comes from the part of its rule that breaks the
  product contract** (collapsing a meeting to one value), not from removing abandoned excursions.
- 15:41 How often the contract-breaking part of A acts on dev (the candidates of the nosys + numwords + loopstop run,
  no model): 20 meeting-slots carry more than one value. In 16 the commonest value is also the last one (11 right, 5
  wrong at the meeting's end); in 4 they differ, and there the commonest value was right 3 times and the last one once
  (the extractor's last write was a late remark). So on AMI dev the majority vote happened to help, but most of A's gain
  is the collapse to one value per meeting (last value on the same base: QA 100 against 102), which is what fixture 1
  forbids; fixture 2 shows the majority vote losing a real decision.
- 15:56 Random-removal control recomputed with the protocol's 1,000 draws (no model, seed 0): commonest value on the
  nosys base QA 102 vs random mean 95.4, 90th percentile 98, 2/1,000 draws reach it, gold kept 28 vs 26.4; on the
  nosys + numwords + loopstop base (nearest to A) QA 99 vs 92.3, 90th percentile 95, 2/1,000, gold kept 28 vs 25.2,
  wrong writes 29 vs 42.7. Passes the rule with 1,000 draws as with 300; descriptive after the variant selection; does
  not change the contract verdict.
- 18:30 **Baseline audit** (`baseline_audit.py`, `baseline-audit.md`, `results/baseline-audit.json`; no model). The
  empty record measured with the real engine (nothing extracted) and both routers: 58/96 on October's test questions
  (0/34 current, 29/29 past date, 29/33 changes) and 69/124 on dev. October's 4B ledger (59/96): 18 questions only it
  gets right, 17 only the empty record (p = 1.0); 18/34 current values and 0 of the 4 real changes. On the 38 questions
  that need a value, October's full context (26) and BM25 (23) are ahead of the 4B ledger (18); the ledger leads only on
  the 58 "none"/0 questions (41 against 15 and 14). DeepSeek's ledger (31/38) and the 4B with a perfect reviewer
  (31/38) clear the floor (p < 0.001). Scorer windows: 13 of 46 test gold events accept any write within more than
  50 turns (widest 369); the attribution specialist's false-credit case (a write about company profit counted as a gold
  event inside a 14-117 window) is cited, not copied. The "app" baseline here is labelled as `f45bbe549` / 0.3.1
  history; `main` 70707fa3b differs in production extraction.
- 18:45 **Harness integrity fixes** after the parent's review (PROTOCOL amendment 18:45). (1) The folder-wide loader
  parsed all eight reserved chains (16 files, confirmed with an open spy) whenever a new-dev series was loaded; nothing
  reserved was generated, scored or used. Now `read_chain` opens exactly the requested files; `test_integrity.py`
  denies every reserved file at the OS open call (audit hook) and recomputes the dev tables and the baseline audit:
  identical to the committed JSON. (2) The app modules were imported from the checkout; they are now the pinned
  `f45bbe549` copies (git blobs identical to `v0.3.1-uat`), hash-checked with 69 in-place files; mixing with a
  checkout's app modules is refused. On a `git archive` of `main` (`c9357d693`, whose `temporal_service.py` and
  `live_assistance.py` differ) the harness loads the pinned copies and every no-model check reproduces. Found while
  checking the README's loopstop claim: on the nosys base, stopping at the first repeat dropped two distinct writes
  (TS3004c speech excluded/included at turns 504/507); and the research `numwords.py` admitted TS3006a price =
  50,000,000 from "sell as much as fifty million Euros" (words confirm a number, not its item). Candidate A's freeze
  file is unchanged; A remains rejected.
- 19:00 Both 1,000-draw random-removal controls recomputed with the pinned harness and every reserved file denied at
  the OS open call (`recheck_controls.py`): identical to their logs in every field (removed writes, base and filter
  QA/gold/wrong, random mean, percentiles, gold and wrong means, share of draws, pass), 0 reserved files opened
  (`logs/recheck-controls-1000-*.json`).
