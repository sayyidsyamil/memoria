# App Ask parity on the AMI test split (November 2026)

**Question.** In October the research pipeline (`../ledger-engine`) answered 96/96 AMI test
questions with gold facts, 59/96 with extracted facts and 85/96 with a perfect reviewer. It used
the language-model router (prompt r1). Does the app's Ask give the same answers?

**Answer.**

- **v0.2.0 (the UAT release) used only the rule router.** It gave October's answer to 89, 86
  and 86 of 96 questions and scored 89, 54 and 80.
- **The current app (`8bb6a30b0`) routes with the evaluated model router** when its Qwen worker
  runs:
  - With October's own router replies, it gives October's answer to 96, 94 and 94 of 96 and
    scores 96, 58 and 84.
  - Live through the running app's worker, the answers are identical: 96, 94 and 94; scores
    96, 58 and 84.
- **The remaining difference is not routing.** IS1009's selling price (2 questions, extracted
  ledgers only) has no approved fact, so Ask hands the question to the wiki answer. October's
  lookup answered "none" and "0 changes" from the empty slot, and the "0 changes" was scored
  correct.

## Result (AMI test, 96 questions, exact match, Wilson 95%)

| Ledger | System | All | Current | As of a past date | How many changes | Same answer as October |
|---|---|---|---|---|---|---|
| Gold facts | October pipeline | 100% [96-100] (96) | 34/34 | 29/29 | 33/33 | |
| | v0.2.0, rule router | 93% [86-96] (89) | 31/34 | 26/29 | 32/33 | 89/96 |
| | current, October's replies (replay) | 100% [96-100] (96) | 34/34 | 29/29 | 33/33 | 96/96 |
| | current, app's worker (live) | 100% [96-100] (96) | 34/34 | 29/29 | 33/33 | 96/96 |
| | current, no worker (rules with tie fix) | 97% [91-99] (93) | 33/34 | 28/29 | 32/33 | 93/96 |
| Extracted facts | October pipeline | 61% [52-71] (59) | 18/34 | 29/29 | 12/33 | |
| | v0.2.0, rule router | 56% [46-66] (54) | 15/34 | 27/29 | 12/33 | 86/96 |
| | current, replay | 60% [50-70] (58) | 18/34 | 29/29 | 11/33 | 94/96 |
| | current, live | 60% [50-70] (58) | 18/34 | 29/29 | 11/33 | 94/96 |
| | current, no worker | 57% [47-67] (55) | 17/34 | 28/29 | 10/33 | 91/96 |
| Extracted, perfect reviewer | October pipeline | 89% [81-94] (85) | 29/34 | 29/29 | 27/33 | |
| | v0.2.0, rule router | 83% [75-90] (80) | 26/34 | 27/29 | 27/33 | 86/96 |
| | current, replay | 88% [79-93] (84) | 29/34 | 29/29 | 26/33 | 94/96 |
| | current, live | 88% [79-93] (84) | 29/34 | 29/29 | 26/33 | 94/96 |
| | current, no worker | 84% [76-90] (81) | 28/34 | 28/29 | 25/33 | 91/96 |

**Disagreements with October.**

- **Replay and live:** only IS1009 q1 and q2 in the two extracted ledgers (no approved fact,
  so the question goes to the wiki).
- **v0.2.0:** 27 question × ledger pairs.
  - "which chip the remote uses" went to *Devices the remote controls* (6 questions).
  - "the colour of the remote's light emitting diode" tied *LED colour* with *Remote shape*
    and went to the wiki (3 questions).
  - IS1009 q1 and q2, as above.
- **No worker (rules with the tie fix):** the LED and IS1009 rows remain (13 pairs).

The result files hold every row with the app's own sentence, its route and the reason.

## Routing

Each question goes through the app's `route_question`, dated as the evaluation dated it, and is
scored as October scored its router. "Correct on gold facts" is the routed answer on the gold
ledger at the evaluation's date.

| Questions | Router | Exact route | Correct on gold facts | Same route as October |
|---|---|---|---|---|
| AMI test (96) | October model router | 81 | 96 | |
| | v0.2.0 rules | 87 | 89 | 74 |
| | current rules (no worker) | 93 | 93 | 78 |
| | current model router, live | 81 | 96 | 88 |
| Synthetic test, second phrasing (37) | October model router | 34 | 34 | |
| | v0.2.0 rules = current rules | 15 (10 to the wiki) | 17 | 13 |
| | current model router, live | **35** | **35** | 36 |

On the phrasings, the live router misses portfolio q10 (Malay-English) and q11 ("around 20 May"):
both put the date in 2025 instead of 2026, exactly as October's router did. It fixes October's
miss on tender q12 ("done or cancelled by 25 March", which October routed as *current*).

## Replay: October's reply for the same prompt

- **How October keyed router calls:** `sha256("mlx-community/Qwen3.5-4B-MLX-4bit\n90\n" + prompt)`
  (`llmcache.CachingMLX._key`; `MLXRouter` asks for 90 tokens). The prompt was
  `router.build_prompt(registry, today, question)`, with `today` the day after the series
  (2026-03-02 for AMI).
- **Where the replies are:** all 96 AMI replies are in `results/cache/ami_test_memoria.jsonl`
  (the review run's cache has the same text), and the 37 phrasing replies are in
  `results/cache/test_memoria.jsonl`.
- **How the app's prompt differs:** it is byte-identical except one line. The question's
  `Today's date: 2026-11-02` comes from `date.today()`, where October had
  `Today's date: 2026-03-02`. The few-shot example's own `Today's date: 2026-03-01` line is
  identical. The registry, round-tripped through `registry.json`, renders the same.
- **What replay does:** it sets that one line back and reads October's reply with October's
  replay tool (`replay_offline.CacheOnly`). Any other difference would be a cache miss
  ("needs model"); none occurred.
- **Result:** with October's replies, the app's `llm_route` (`parse_route`, then
  `_complete_attribute`, then the history mapping) gives October's route in 96/96 AMI questions
  and 37/37 phrasings.

## Live: the app's own worker

- **Which worker:** the installed app's `model_server.py`, a child of the running Memoria.app,
  with no `MEMORIA_LLM_MODEL` override, so Qwen3.5-4B-MLX-4bit. It is reached only through
  `engine.local_generator()` with `MEMORIA_QWEN_SOCKET`. The script starts and stops no process
  and connects to no other socket.
- **Cached replies:** all 229 replies are in `live-replies.jsonl`. These are 96 AMI prompts at
  the app's date, 96 at October's date and 37 phrasings.
- **Different model input:** the worker adds a system message ("Follow the requested JSON
  structure exactly…") and allows up to 1800 tokens, with greedy decoding. October sent the
  prompt alone with a 90-token cap.
- **Identical prompt text:** the worker's reply is byte-identical to October's in 88/96 AMI and
  36/37 phrasing cases. The 8 AMI differences are lookup type or record date on "as of
  5 February" questions, and all give the same answer.
- **At the app's own date** (2 November), 82/96 routes are exact and 82 equal October's route.
  The other 14 are the same kind of difference and give the same answers.
- **Latency:** the rule router answers in 0.004–0.006 s per Ask (median, whole `engine.py`
  request). With the model router, a worker call takes a median of 3.38 s (mean 3.73 s); a whole
  Ask with a new prompt takes a median of 3.11 s. So routing adds about 3 s per question on this
  Mac. Three consecutive calls took 20–24 s while the worker probably served another client of
  the running app; max 23.8 s, 0 worker errors.

## Threats

- **Test-set exposure of the tie fix.** It is still in the rule fallback, which is used without
  a worker or after an unusable reply. It was found on this test split and changes routes only
  there (the 6 chip questions), so the "no worker" rows are not held-out.
- **Model input differs from October's.** The model router is the evaluated one, but the
  worker's input is not October's: system message, 1800-token cap and the real date. Answers
  matched here (88/96 replies identical, all answers equivalent), but that is not guaranteed for
  other questions. Replay parity is exact only for October's own replies.
- **Latency cost.** Every Ask with a worker pays one router call (about 3 s), including
  questions that end in the wiki answer. Latency was measured with the app running and its worker
  shared.
- **Wiki hand-over.** A hand-over to the wiki is scored wrong. In a vault with built knowledge
  the app would draft an answer with the model; that answer was not measured.
- **How the ledgers were written.** The evaluated pipeline code wrote them into the app's store,
  not the app's ingest-and-review flow. The 96 questions come from three templates; the
  phrasings were written by the AI assistant, two sets in Malay-English.
- **Phrasing accuracy uses the evaluation's date, not the app's clock.** One `hiring` slot has
  a different value on 2 November than on the chain's date.

## Run

```sh
cd ~/Documents/memoria-workspace && P=research/app-parity
env -u MEMORIA_QWEN_SOCKET /opt/homebrew/bin/python3.11 $P/ask_parity.py --router rules --out $P/results-rules.json    # no worker
/opt/homebrew/bin/python3.11 $P/ask_parity.py --router replay --out $P/results-replay.json                            # October's replies, no model
MEMORIA_QWEN_SOCKET=$(print -r -- ${TMPDIR%/}/mm-$(pgrep -f /Applications/Memoria.app/Contents/MacOS/memoria | head -1)-*-qwen.sock) \
  /opt/homebrew/bin/python3.11 $P/ask_parity.py --router live --out $P/results-live.json                              # the app's worker
T=$(mktemp -d) && mkdir -p $T/$P && cp $P/ask_parity.py $T/$P/ && ln -s "$PWD/research/ledger-engine" $T/research/ledger-engine \
  && git archive v0.2.0-uat src-tauri/resources/memory | tar -x -C $T \
  && env -u MEMORIA_QWEN_SOCKET /opt/homebrew/bin/python3.11 $T/$P/ask_parity.py --router rules --out $P/results-v0.2.0.json
```

- **Run times:** rules and replay take seconds. Live took 14 minutes for 229 worker calls.
- **Live without the app:** live mode without a worker socket answers from
  `live-replies.jsonl` only. On 2 November that reproduced `results-live.json` exactly. On
  another day the app dates its prompts differently, so its 96 Ask prompts are recorded as
  "needs model", while the route check still reproduces.

Each result file records the router mode and the sha256 prefix of the `ask_facts.py` used
(`6403b0d6f4bb` v0.2.0, `55538695ca34` current). Run on Apple M5, 16 GB, Python 3.11.18.
