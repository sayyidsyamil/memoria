# Does a stronger model change the ledger result?

DeepSeek V4.1 Flash in place of Qwen3.5-4B on the frozen AMI test split. The October prompts and code are unchanged; only the model differs.

## Question

The October evaluation ([`../ledger-engine/`](../ledger-engine/), `results/ami/ami_test_report.md`) used one local
model, Qwen3.5-4B, for all three methods. The Memoria ledger scored 59/96, full-context prompting with chain of thought
41/96, and BM25 retrieval 37/96. With gold facts the ledger scores 96/96, so all of its errors are extraction errors.
Two questions follow:

1. **Does the ledger get better with a better extractor?**
2. **Would a strong model with all transcripts in the prompt make the ledger unnecessary?**

## Answer

1. **Yes.** With DeepSeek as the extractor the ledger scores **82/96** against 59/96 for Qwen. The paired sign test gives
   27 questions fixed and 4 broken, p < 0.001. Extraction F1 rises from 32% to 51% (precision 21% → 38%,
   recall 67% → 76%). The review inbox shows 0.80 proposals per meeting instead of 1.75. All 14 remaining errors are
   extraction errors; there are no routing errors.
2. **Not on accuracy at this scale.** With the same strong model, full context scores **81/96** and the ledger 82/96:
   10 questions only the ledger answers, 9 only full context, p = 1.0. The ledger still beats BM25 (70/96, p = 0.029).
   Full context with DeepSeek also beats the ledger the app runs today, the local Qwen ledger: 81 vs 59, p < 0.001.
   The case for the ledger therefore does not rest on accuracy over four meetings. It rests on four other things:
   - It runs locally with a 4B model. Full context with that model scores 41/96, and the app never sends transcripts to
     a hosted model.
   - Each question costs a constant 818 input tokens. Full context reads every transcript for every question: 31k tokens
     after only four meetings, $0.0048 per question at list price without the provider's prompt cache.
   - Its lookups are exact. Of full context's 15 errors, 5 answer a past-date question from a decision made after that
     date, and 4 count the first setting of a value as a change. The ledger cannot make either error once a fact is
     stored: past date 28/29 against 24/29, though p = 0.22.
   - Every answer carries its quote.
   - The [growth follow-up](#follow-up-does-the-ledger-hold-up-as-a-series-grows) tests the growth claim on series padded
     to 52 meetings. The DeepSeek ledger holds up (37 → 36 of 37), but so does full context (32 → 34). Input tokens per
     question grow ×1.6 for the ledger against ×8.1 for full context.

## Setup

| | |
|---|---|
| Model | `deepseek/deepseek-v4.1-flash-1017` through OpenRouter, 2 November 2026, 12:46–13:12 UTC |
| Serving | All calls pinned to one endpoint: StreamLake, fp8 (`provider.order = ["streamlake"]`, `allow_fallbacks = false`, `require_parameters = true`). Its list price matches the first-party DeepSeek endpoint ($0.15 / $0.60 / $0.003 per million input / output / cached input), but that endpoint was degraded at setup (OpenRouter uptime 0% over the last 5 minutes, 57% over the last day). All 405 responses report StreamLake. |
| Decoding | Temperature 0 (October decoded greedily). One user message holding the October prompt. `max_tokens` unchanged: extraction 900, router 90, full context with chain of thought 4096, BM25 direct answer 24. |
| Reasoning | The model reasons by default (OpenRouter metadata: `default_enabled: true`, `default_effort: high`). Every call used `reasoning.effort = "none"`, the lowest supported setting, which matches October's Qwen with thinking off. All 405 responses had 0 reasoning tokens and were in the required format. |
| Prompts and code | Unchanged and imported, not copied: extractor prompt v2 (`7f816362cd95`), router r1, baseline prompt v3 (`fc+cot`, `bm25-12`), `scripts/ami/run_ami.py`, `run_ami_review.py`, `review_burden.py`, `render_ami.py`, and the October metrics, including `paired_sign_test`. `run.py` replaces `memoria_engine.llmcache.CachingMLX` with `CachingOpenRouter` (see `openrouter.py`), the same swap October's `replay_offline.py` makes. Before any paid call, the current engine replayed both October test caches identically (`REPLAY IDENTICAL`). |
| Data | The frozen test split: ES2004, ES2014, IS1009, TS3003 and TS3007, 20 meetings, 96 questions (34 current value, 29 value on a past date, 33 number of changes), 46 gold decisions |
| Sanity | Two calls on the dev split (ES2003), both parsed by the October parsers. The extraction window returned both gold decisions in it, grounded. The route parsed. |
| Review inbox | As in October: the `confirm_conflicts` policy with the oracle reviewer (`run_ami_review.py`). The cache was seeded from the immediate run, so only 12 requests were new. |

## Spend

Limit $1.00, own cap $0.90. Every run printed an estimate from the October prompts before starting and would have
refused to start if the expected cost without caching exceeded the money left. During a run, a call whose worst case
would cross the cap is not made. Every response is cached by request hash in `cache/*.jsonl`, and every paid request is
logged with a running total in `spend.jsonl`.

| Run | Requests paid | Estimate (no cache / worst) | Paid |
|---|---|---|---|
| Dev sanity | 2 | – | $0.0007 |
| (a) Ledger, immediate | 199 | $0.064 / $0.113 | $0.0411 |
| (a) Ledger, review run (new requests only) | 12 | $0.033 / $0.061 | $0.0047 |
| (b) Full context + chain of thought | 96 | $0.477 / $0.687 | $0.0466 |
| (c) BM25 k=12 | 96 | $0.036 / $0.038 | $0.0302 |
| **Total** | **405** (0 failures, 0 retries) | | **$0.1232** |

Key before: $0.0000 used of $1.00. Key after: $0.1232 used, **$0.8768 remaining**. The sum of the responses'
`usage.cost` equals the key's usage. Full context cost $0.047 rather than the $0.48 estimate because the provider cached
the transcript prefix the 19 questions of each team share: 29.5k of 31.3k input tokens per question were read from the
cache.

## Results (AMI test split, 96 questions, exact match)

| Method | Model | All | Current (34) | Past date (29) | Changes (33) |
|---|---|---|---|---|---|
| Ledger (extract + route) | Qwen3.5-4B, October | 59 (61%) | 18 | 29 | 12 |
| Ledger (extract + route) | **DeepSeek V4.1 Flash** | **82 (85%)** | 29 | 28 | 25 |
| Full context + chain of thought | Qwen3.5-4B, October | 41 (43%) | 24 | 6 | 11 |
| Full context + chain of thought | **DeepSeek V4.1 Flash** | **81 (84%)** | 30 | 24 | 27 |
| BM25 k=12 | Qwen3.5-4B, October | 37 (39%) | 22 | 14 | 1 |
| BM25 k=12 | **DeepSeek V4.1 Flash** | **70 (73%)** | 19 | 29 | 22 |
| Ledger, gold facts (router only) | Qwen / DeepSeek | 96 / 96 | 34 / 34 | 29 / 29 | 33 / 33 |
| Ledger + oracle reviewer (upper bound) | Qwen / DeepSeek | 85 / 88 | 29 / 31 | 29 / 28 | 27 / 29 |

Wilson 95% intervals, DeepSeek: ledger [77–91]%, full context [76–90]%, BM25 [63–81]%. October: [52–71]%, [33–53]%, [29–48]%.

**Paired exact sign test** (October `paired_sign_test`, same 96 questions, two-sided; exploratory, no correction for multiple comparisons):

| A vs B | Model | A only right | B only right | Both | Neither | p |
|---|---|---|---|---|---|---|
| Ledger vs full context + chain of thought | Qwen, October | 34 | 16 | 25 | 21 | 0.015 |
| Ledger vs BM25 | Qwen, October | 31 | 9 | 28 | 28 | <0.001 |
| Ledger vs full context + chain of thought | DeepSeek | 10 | 9 | 72 | 5 | 1.000 |
| Ledger vs BM25 | DeepSeek | 19 | 7 | 63 | 7 | 0.029 |
| Ledger with DeepSeek vs ledger with Qwen | – | 27 | 4 | 55 | 10 | <0.001 |
| Full context with DeepSeek vs ledger with Qwen | – | 31 | 9 | 50 | 6 | <0.001 |

The DeepSeek ledger against DeepSeek full context, by type: current 2 vs 3, past date 5 vs 1 (p = 0.22), changes 3 vs 5.
Against DeepSeek BM25: current 12 vs 2 (p = 0.013), past date 0 vs 1, changes 7 vs 4.

**Extraction** against the 46 gold decisions (October scorer; bootstrap 95% interval over meetings):

| Extractor | TP | FN | FP | Precision | Recall | F1 | Proposals per meeting (max; total) | Items right after the last meeting |
|---|---|---|---|---|---|---|---|---|
| Qwen3.5-4B | 31 | 15 | 116 | 21% [14–29] | 67% [49–81] | 32% [22–42] | 1.75 (10; 35) | 18/34 |
| DeepSeek V4.1 Flash | 35 | 11 | 56 | 38% [30–48] | 76% [62–90] | 51% [42–60] | 0.80 (3; 16) | 29/34 |

The oracle reviewer rejected 22 of Qwen's 35 proposals and 7 of DeepSeek's 16. The DeepSeek router picks the exact
lookup for 67 of 96 questions (Qwen: 81). All 29 misses are past-date questions read as "what the records said on that
date", with tx_at equal to valid_at. That lookup returns the same answer in all 29 cases, so routing costs nothing.

**Cost, latency and tokens.** Measured cost is the responses' own `usage.cost`, including cache discounts. List price is
the same tokens at $0.15 / $0.60 per million with no cache. Seconds are median (mean) wall time over the internet; for
a meeting, the sum of its windows. October timings are from an Apple M5 and cost no money.

| Method | Per | DeepSeek measured | DeepSeek list, no cache | DeepSeek s | DeepSeek tokens in / out | Qwen s, October | Qwen tokens in / out, October |
|---|---|---|---|---|---|---|---|
| Ledger: read a meeting, once at ingestion | meeting | $0.00189 | $0.00222 | 13.9 (15.4) | 13,430 / 347 | 63.2 (mean) | 14,374 / 836 |
| Ledger: answer (router and lookup) | question | $0.000034 | $0.000142 | 2.6 (2.9) | 818 / 32 | 2.9 (3.0) | 860 / 30 |
| Ledger, all-in on this test set (20 meetings, 96 questions) | question | $0.00043 | $0.00060 | – | 3,616 / 104 | – | 3,854 / 204 |
| Full context + chain of thought | question | $0.00048 | $0.00483 | 5.7 (6.1) | 31,337 / 215 | 84.2 (88.2) | 34,258 / 449 |
| BM25 k=12 | question | $0.00031 | $0.00035 | 1.3 (2.0) | 2,291 / 3 | 3.4 (3.4) | 2,465 / 2 |

## Failure analysis: the 14 questions the DeepSeek ledger still misses

There are no routing errors. Every miss comes from the facts the extractor wrote: 8 spurious changes, 4 wrong current
values, 1 decision recorded before it was made, and 1 missed decision. Ten of the 14 were also wrong with Qwen. DeepSeek
fixes 27 of Qwen's 37 errors and breaks 4. Full detail, including each slot's value timeline, is in
[`results/summary.md`](results/summary.md).

| Team, question | Type | Gold | Ledger | What the extractor wrote |
|---|---|---|---|---|
| ES2004 q1, q3 | current, changes | kinetic, 1 | conventional, 3 | A suggestion read as a decision: d "Instead of going for kinetic how about going for a standard battery" (and c "no rechargeable option available" → conventional) |
| ES2004 q4 | current | included | none | Missed: the Video Plus decision in b was not extracted |
| ES2004 q11 | past date | none | black and white | Too early: a "you'd have to sort of keep it down to a black and white L_C_D_ thing anyway, I'd assume" (gold: decided in d) |
| ES2014 q8 | changes | 0 | 1 | c "So you'd have a finder feature rather than a voice recognition feature" → excluded, then included |
| ES2014 q17 | changes | 1 | 3 | d "We got rid of the plastic." → rubber written between two plastic decisions |
| ES2014 q20 | changes | 0 | 1 | A conditional read as a decision: c "if you use the uh rubber double curved case then you must use rubber buttons" |
| IS1009 q9, q11 | current, changes | plastic, 0 | rubber, 1 | Wrong item: d "Rubber, because we're gonna have the soft buttons." (about the buttons) written as the case material |
| IS1009 q14 | changes | 0 | 1 | c "We'll just go for push buttons for in the interest of cost." → hard plastic buttons |
| TS3003 q5 | current | multiple devices | televisions only | The meeting a decision was not extracted. b "we've uh got to design a um remote which is only suitable for T_V_" is a new requirement from management. **Gold probably incomplete**: the abstract lists no change, and Qwen and DeepSeek full context answer the same. |
| TS3003 q9 | changes | 0 | 1 | A tentative remark: b "I think we'll have to choose between the docking station or the screen…" → LCD excluded |
| TS3003 q10, q12 | current, changes | included, 0 | excluded, 1 | d "Considering we are not going to make a docking station." This may be a decision the abstract does not list. |

Pattern: the stronger extractor misses less, and it halves both the extra writes (116 → 56) and the review
proposals. What remains is mostly firmness: it still reads a tentative, conditional or off-item remark as a decision.
In the "number of changes" questions such a remark becomes an extra change. This is the error class the review inbox
targets: with an oracle reviewer the DeepSeek ledger reaches 88/96.

## Threats to validity

- **One model, one run.** Temperature 0 on a hosted endpoint is not guaranteed to be deterministic. 96 questions over 5
  teams, and no correction for multiple comparisons.
- **Hosted vs local.** DeepSeek ran as fp8 on a third-party endpoint (StreamLake), not the first-party one. Its latencies
  include network and queueing and are not comparable to the M5 timings. The app itself never sends transcripts to a
  hosted model; this experiment did, which is acceptable only because AMI is public (CC BY 4.0).
- **Training-data exposure.** The AMI transcripts and the human abstracts the gold was derived from have been public
  since 2005, and a hosted model may have seen them. That would favour both DeepSeek methods and cannot be ruled out here.
- **The test split is not fresh.** It was seen in October. Prompts were frozen and nothing was tuned in this run, but the
  question set itself is unchanged since October.
- **Short series.** Four meetings (31k tokens) fit easily in a 1M-token context. This says nothing about long histories,
  where full context's input and cost grow with every meeting and the ledger's do not.
- **Measured costs depend on the provider cache.** The 19 questions per team were asked back to back. Asked one at a time,
  full context costs about ten times more ($0.0048 per question at list price).
- **October's 24-token cap on direct answers.** 3 of DeepSeek's BM25 answers began reasoning, were cut off by this cap
  and were scored wrong.
- **Gold.** It was derived from the AMI abstracts by an AI assistant (the October caveat). It lists only the decisions
  the annotators wrote down, so precision is a lower bound, and one to three of the 14 "errors" above may be gold
  omissions.

## Follow-up: does the ledger hold up as a series grows?

**Question.** On AMI's four-meeting series, a strong model reading every transcript matches the ledger (81 vs 82). The
ledger's remaining claim is that it holds up as a series grows while reading everything does not, and that its cost per
question stays flat. I tested both on October's growth experiment. Its three synthetic test chains (hiring, portfolio,
tender; 37 questions) are padded with K template-written filler meetings about look-alike items. October's Qwen results
from K = 0 to 48: ledger 76% → 65%, full context 62% → 62%, BM25 59% → 35%.

**Setup.**
- `memoria_engine/evaluation/run_scaling.py` runs unchanged: data `pilot_v0`, test split, filler generator g1, seed 0.
- It is driven by `scaling.py`, which swaps the model as `run.py` does. Settings as above: StreamLake, temperature 0,
  reasoning off, max_tokens 900 / 90 / 4096.
- Before paying, today's engine replayed October's K = 0, 24 and 48 from its cache identically, for both the ledger and
  full context.
- Levels run: K = 0, 24 and 48. K = 24 was included because the estimate clearly allowed it; K = 8 and BM25 were not rerun.
- Run on 2 November 2026, 13:22–13:34 UTC, as two concurrent processes.

**Spend.** The estimate printed before running was $0.190 without caching, $0.111 with the provider cache, and $0.543
worst case. Paid: **$0.0878**, of which $0.0639 for the ledger (360 requests) and $0.0239 for full context (111
requests). There were no failures, no retries and no reasoning tokens. The key total is now **$0.2111**.

| 37 questions | K = 0 | K = 24 | K = 48 |
|---|---|---|---|
| Meetings per chain (mean) | 3.7 | 27.7 | 51.7 |
| Tracked items per chain (mean) | 3.0 | 12.7 | 20.0 |
| Full-context prompt, DeepSeek tokens (mean) | 866 | 3,944 | 6,978 |
| Ledger, Qwen3.5-4B (October) | 28 (76%) | 26 (70%) | 24 (65%) |
| **Ledger, DeepSeek** | **37 (100%)** | **37 (100%)** | **36 (97%)** |
| Ledger with gold facts, DeepSeek router | 37 | 37 | 37 |
| Full context + chain of thought, Qwen (October) | 23 (62%) | 24 (65%) | 23 (62%) |
| **Full context + chain of thought, DeepSeek** | **32 (86%)** | **30 (81%)** | **34 (92%)** |
| BM25 k=12, Qwen (October, not rerun) | 22 (59%) | 17 (46%) | 13 (35%) |

Paired exact sign test (October `paired_sign_test`; A only right / B only right, two-sided p):

| A vs B | Model | K = 0 | K = 24 | K = 48 |
|---|---|---|---|---|
| Ledger vs full context | DeepSeek | 5 / 0, p = 0.062 | 7 / 0, p = 0.016 | 3 / 1, p = 0.625 |
| Ledger vs full context | Qwen (October) | 11 / 6, p = 0.332 | 9 / 7, p = 0.804 | 8 / 7, p = 1.000 |

Change from K = 0 to K = 48 on the same questions (right only at K = 0 / right only at K = 48):

| Method | DeepSeek | Qwen (October) |
|---|---|---|
| Ledger | 1 / 0, p = 1.000 | 4 / 0, p = 0.125 |
| Full context | 2 / 4, p = 0.688 | 5 / 5, p = 1.000 |

Cost, tokens and latency per question with DeepSeek. List price means no cache; measured means with the provider cache.
Seconds are medians.

| K | Ledger answer: tokens in / out | List | Measured | s | Ledger: read one meeting (list) | Full context: tokens in / out | List | Measured | s |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 771 / 32 | $0.000135 | $0.000061 | 1.4 | $0.00026 | 866 / 110 | $0.00020 | $0.00011 | 2.5 |
| 24 | 1,030 / 32 | $0.000174 | $0.000041 | 1.2 | $0.00028 | 3,944 / 132 | $0.00067 | $0.00022 | 2.0 |
| 48 | 1,229 / 32 | $0.000204 | $0.000049 | 1.3 | $0.00032 | 6,978 / 120 | $0.00112 | $0.00031 | 2.2 |

October Qwen on the M5: full context 6.7 → 18.3 → 27.9 s per question (median), ledger router 2.2 → 3.3 → 4.1 s.

**Truncation.** None with DeepSeek: all 471 outputs finished normally. That covers 111 full-context answers (cap 4096),
249 extractions (cap 900) and 111 routes (cap 90). October's Qwen full context had 1, 6 and 5 answers cut at 4096
tokens at K = 0, 24 and 48.

**What it shows.**
- **The DeepSeek ledger holds up:** 37, 37, 36. Its router is exact on 37/37 at every K, and with gold facts it scores
  37/37. Extraction F1 on the original meetings is 98%, 98% and 95%.
- **The one K = 48 miss is crowding.** With 20 tracked items, several of them other teams' headcounts, the extractor
  marked 2 of the original decisions as unresolved. One answer changed: the headcount plan as recorded on 20 May reads 4
  instead of 6. Qwen's October drop (76% → 65%) was its own extraction under the same crowding.
- **Reading everything also holds up at these lengths.** DeepSeek full context scores 32, 30 and 34. From K = 0 to
  K = 48 it gains slightly: 2 questions only right at K = 0, 4 only right at K = 48, p = 0.69.
- **The ledger leads at every K, but the gap does not widen.** It is significant only at K = 24 (p = 0.016). So the
  claim that reading everything degrades as a series grows is **not supported** for a strong model up to about 7k
  tokens.
- **Why full context misses.** Its errors are about effective dates and reversals: applying a postponement before it
  takes effect, or counting a change that was later withdrawn. At K = 24, two misses are answer-format errors: it listed
  every attribute ("owner = raj; deadline = 2026-06-15; status = cancelled") with the right value inside.
- **Cost per question.** The ledger's grows with the number of tracked items, because the router prompt lists them:
  771 → 1,229 tokens, ×1.6. Full context's grows with the whole history: 866 → 6,978 tokens, ×8.1, or $0.00020 →
  $0.00112 per question at list price (×5.6).
- **The ledger pays once per meeting**, $0.00026–0.00032 at list price, so the cheaper method depends on how often a
  series is queried. On these chains the ledger becomes cheaper once a series has been asked about 16–18 questions in
  total at list price, at every K. With the provider cache helping full context, the threshold is 18–47 questions.
  Below that, reading everything costs less.
- **Latency was flat for both at these sizes:** ledger 1.2–1.4 s, full context 2.0–2.5 s (medians).

**Threats.**
- **Template padding tests length and crowding, not language understanding.** The padding means more meetings and more
  look-alike items to keep apart. The filler is regular template text, which DeepSeek extracts at F1 99.6–99.8%.
- **Short in tokens.** The longest full-context prompt is about 7k tokens at K = 48: under 1% of the model's 1M-token
  window, and far below the lengths where long-context degradation is reported. This run shows no degradation up to
  about 7k tokens; it cannot say what happens with hundreds of real meetings.
- **Three chains and 37 questions**, written with AI help and seen in October. One run at temperature 0 on a hosted
  endpoint, with no correction for multiple comparisons.
- **Concurrent runs.** The two methods ran concurrently, so latencies include network and provider queueing. A few
  slow calls at K = 0 raise the full-context mean to 7.7 s against a 2.5 s median.
- **The break-even point depends** on prices, the provider cache and how often a series is queried. It was computed on
  these chains only.

## Reproduce

```sh
cd research/strong-model                      # Python 3.11 with requests; key file via OPENROUTER_KEY_FILE
python3.11 run.py key                         # usage and limit of the key (the key itself is never printed or stored)
python3.11 run.py estimate                    # tokens and cost of every run, from the October prompts
python3.11 run.py sanity                      # 2 dev calls, parsed by the October parsers
python3.11 run.py run memoria                 # (a) ledger: DeepSeek extracts and routes
python3.11 run.py run memoria-review          # (a) the same with the October oracle reviewer
python3.11 run.py burden                      # proposals per meeting (October review_burden.py, offline)
python3.11 run.py run fc                      # (b) full context + chain of thought
python3.11 run.py run bm25                    # (c) BM25 k=12
python3.11 run.py render                      # October-format reports: results/deepseek_test_report.md, deepseek_test_review_report.md
python3.11 summarize.py                       # results/summary.md and summary.json: the tables above, failures, spend
# follow-up: growth experiment (October run_scaling.py, K = 0, 24, 48)
python3.11 scaling.py replay                  # free: today's engine reproduces October's K = 0, 24, 48 from its cache
python3.11 scaling.py estimate                # free: tokens and cost per K and method, from the October prompts
python3.11 scaling.py run memoria             # ledger: DeepSeek reads every meeting, padding included, then routes
python3.11 scaling.py run fc                  # full context + chain of thought
python3.11 scaling.py summarize               # results/scaling_summary.md and scaling_summary.json
```

All 876 responses are in `cache/`, so re-running replays them at no cost. A run still checks the key before and after,
so it needs the key file. `summarize.py`, `burden`, `render`, `scaling.py replay`, `estimate` and `summarize` need no key.

| File | What it is |
|---|---|
| `openrouter.py` | The model call: OpenRouter request, cache keyed by request sha256, spend log, budget guard, one retry, failure log |
| `run.py` | Runs the October scripts with the model swapped; estimate, sanity, burden, render |
| `summarize.py` | Comparison with October, sign tests, cost, latency and tokens, failure analysis |
| `scaling.py` | Follow-up: October `run_scaling.py` with the model swapped; replay check, estimate, run, summary |
| `cache/` | Every response, with tokens, cached tokens, reasoning tokens, cost, provider and latency |
| `results/` | Run reports in the October format, `summary.md` / `summary.json`, `scaling_*_test.json`, `scaling_summary.md` / `.json` |
| `spend.jsonl`, `logs/` | Every paid request and key check with the running total; run logs |
