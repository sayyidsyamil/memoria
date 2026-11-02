# A faster live contradiction check: the guard alone

**Question.** The app's live check wrote a verdict with Qwen3.5-4B (`{"contradiction", "reason", "factId"}`) and then
had the guard (a one-word YES/NO question, scored from the first token) confirm it. In a meeting that took about 4 s per
sentence, so a cue appeared 8–17 s after the words. Can the guard's question alone, asked about each candidate decision,
replace the written verdict without losing accuracy?

**Answer.** Yes. On the held-out MemoriaBench test split it catches the same conflicts with fewer false alarms, never
leaves a sentence unverified, and answers in a fifth of the time.

| Live check (test split, 336 probes, 28 series) | Conflicts caught | False alarms | Unverified | Latency p50 / p95 |
|---|---|---|---|---|
| Written verdict, then guard (shipped, `../memoriabench/results/app_live_check/guard_on.jsonl`) | 91 / 112 (81.3%) | 3 / 224 (1.3%) | 3 | 4.0 / 6.8 s |
| **Guard alone, threshold 2.0 (new default)** | **91 / 112 (81.3%)**, CI 74.1–87.5 | **2 / 224 (0.9%)**, CI 0–2.2 | **0** | **0.83 / 1.83 s** |

- Paired: the guard alone is right on 7 probes the shipped check gets wrong and wrong on 6 it gets right (exact
  McNemar p = 1.0). Accuracy is unchanged; the gain is speed and no unverified sentences.
- 85 of the 91 caught conflicts cite the reference decision (shipped: 85).
- Intervals are 95% cluster-bootstrap intervals by series (`eval_metrics`).

## Method

`live_assistance.py`, `MEMORIA_LIVE_CHECK=guard` (now the default):

1. The app's own gates run unchanged: lexical relevance, quoted evidence, the deterministic numeric proof and the
   past-tense filter. A sentence sharing no word with any decision costs nothing.
2. Candidates are the up-to-three slots with the most IDF-weighted word overlap (`live_guard.candidates`, the guard's
   attribution set) plus the lexically selected facts, at most five, each with quoted evidence.
3. The guard's exact question (`live_guard.question`, wording pinned by research) is scored for each candidate; the
   strongest confirmation at log-odds **2.0** or more is cued. The guard's confirmation threshold is 1.0; asked about up
   to five candidates instead of one cited decision, it needs more confidence. 2.0 was chosen on the **dev split only**
   (60 probes) from the scores of a run at 1.0, before the test split was run once.
4. The Qwen worker keeps the model state after the question's shared opening (rules and worked examples), so each
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
