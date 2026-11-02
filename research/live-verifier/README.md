# A faster, wider live contradiction check

**Question.** The app's live check wrote a verdict with Qwen3.5-4B (`{"contradiction", "reason", "factId"}`) and then
had the guard (a one-word YES/NO question, scored from the first token) confirm it. In a meeting that took about 4 s per
sentence, so a cue appeared 8–17 s after the words, and a sentence that did not share a word with a decision's name was
never checked. Can the guard's question alone replace the written verdict, and can candidate decisions be found by
meaning as well as by shared words?

**Answer.** Yes to both. On the held-out MemoriaBench test split the final check catches 100 of 112 conflicts instead of
91, with the same 2 false alarms in 224, in 0.56 s instead of 4.0 s (median).

| Live check (test split, 336 probes, 28 series) | Conflicts caught | False alarms | Unverified | Latency p50 / p95 |
|---|---|---|---|---|
| Written verdict, then guard (shipped before, `../memoriabench/results/app_live_check/guard_on.jsonl`) | 91 / 112 (81.3%) | 3 / 224 (1.3%) | 3 | 4.0 / 6.8 s |
| Guard alone, threshold 2.0 | 91 / 112 (81.3%) | 2 / 224 (0.9%) | 0 | 0.83 / 1.83 s |
| **Guard alone + candidates by meaning (new default)** | **100 / 112 (89.3%)**, CI 83.0–94.6 | **2 / 224 (0.9%)**, CI 0–2.2 | **0** | **0.56 / 1.72 s** |

- Paired, the final check against the guard alone: right on 10 probes it got wrong, wrong on 1 it got right (exact
  McNemar p = 0.012). Against the shipped check: 17 against 7 (p = 0.064).
- 93 of the 100 caught conflicts cite the reference decision.
- Research M2, which read the whole ledger with a written verdict, caught 110/112 (`../memoriabench/GUARD.md`).

## Method

`live_assistance.py`, `MEMORIA_LIVE_CHECK=guard` (now the default):

1. The app's own gates run unchanged: lexical relevance, quoted evidence, the deterministic numeric proof and the
   past-tense filter. A sentence sharing no word with any decision costs nothing.
2. Candidates are the up-to-three slots with the most IDF-weighted word overlap (`live_guard.candidates`, the guard's
   attribution set) plus the lexically selected facts, at most five, each with quoted evidence.
3. **Candidates by meaning** (`live_assistance._semantic`): the sentence is embedded by the app's EmbeddingGemma 2
   worker with its fact-checking prompt (`task: fact checking | query: …`), each current decision as `title: <item> |
   text: <item> <attribute> is <value>` (vectors cached beside the ledger); the two closest decisions with cosine 0.66
   or more join the candidates. This finds sentences that name an item in other words ("We will launch on the 20th":
   0.74 to the go-live date, 0.55–0.60 to the others) and lets them be checked at all. The floor was chosen on the
   dev split (0.60, 0.66 and 0.72 gave the same dev result) and on such paraphrases, before the test split was run.
4. The guard's exact question (`live_guard.question`, wording pinned by research) is scored for each candidate; the
   strongest confirmation at log-odds **2.0** or more is cued. The guard's confirmation threshold is 1.0; asked about up
   to five candidates instead of one cited decision, it needs more confidence. 2.0 was chosen on the **dev split only**
   (60 probes) from the scores of a run at 1.0, before the test split was run once.
5. The Qwen worker keeps the model state after the question's shared opening (rules and worked examples), so each
   question runs only its last few dozen tokens (`model_server.score_first_tokens`). On two probe sentences the cached
   and uncached log-odds were 7.0 vs 7.0 and 0.62 vs 0.50 (`bf16` rounding after a different prefill split).

Dev split (60 probes: 20 conflicts, 40 must-not-alert), same worker unless noted:

| Variant | Caught | False alarms | Unverified | p50 / p95 |
|---|---|---|---|---|
| Written verdict, then guard (old worker) | 14 / 20 | 3 / 40 | 2 | 3.1 / 7.8 s |
| Written verdict, then guard (new worker: 320-token cap, prefix cache) | 14 / 20 | 3 / 40 | 2 | 3.5 / 5.5 s |
| Reason first, then verdict (old worker) | 15 / 20 | 2 / 40 | 0 | 4.0 / 7.0 s |
| Guard alone, threshold 1.0 | 17 / 20 | 4 / 40 | 0 | 0.95 / 1.36 s |
| Guard alone, threshold 2.0 (from the same scores) | 16 / 20 | 2 / 40 | 0 | |
| Guard alone + candidates by meaning (cosine 0.60, 0.66 or 0.72) | 17 / 20 | 2 / 40 | 0 | 0.66 / 1.25 s |

Figures and dates (`_spoken_amount`, `_spoken_date`) are compared without the model in the app; MemoriaBench's
decisions are sentences, so these comparisons never apply to it and the benchmark numbers above are unaffected.

The written verdict sometimes argued with itself after committing to `"contradiction": false` (6,304 characters for
"the pilot budget is now three hundred thousand ringgit", 60 s); the worker now caps a verdict at 320 tokens.

## Limits

MemoriaBench's sentences are clean templated English, not speech; the mapping of AMI decisions to slots is the
harness's (see `../memoriabench/APP_LIVE_CHECK.md`). One machine (M5, 16 GB), one 4B model. The threshold was chosen on
dev, then the test split was run once.

## Files

- `run.py`: runs the bench with a verifier variant (`baseline`, `reason_first`); the guard-alone runs set
  `MEMORIA_LIVE_CHECK=guard` with `baseline`.
- `results/dev_*.jsonl`, `results/test_guard_first.jsonl`: predictions; `*.summary.json`: harness summaries (the
  `comparison` block in `test_guard_first.summary.json` compared the run with itself and is void; the paired numbers
  above were computed against the shipped predictions directly).
