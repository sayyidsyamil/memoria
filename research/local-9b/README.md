# Can a larger local model fix the ledger's bottleneck? Qwen3.5-9B on the October pipeline

**Status: incomplete. Only the dev split was run; the test split was not.** While the 9B's dev review run was going, this
16 GB Mac (with a browser, Defender and other apps open) came under so much memory pressure that it became unusable.
The run was stopped by hand and the 9B weights moved aside. No model was loaded after that. Every number below comes from
call caches and run logs. The memory pressure is itself a result about running a 9B extractor beside Memoria's speech
and embedding models ([Memory](#memory-the-practical-finding)).

## Question

On the AMI test split (20 meetings, 96 questions, 46 gold events), October's ledger scored 59/96 with Qwen3.5-4B (4-bit
MLX) as extractor and router. It scored 82/96 with DeepSeek V4.1 Flash ([`../strong-model`](../strong-model/README.md))
and 96/96 with gold facts. A firmness gate on the 4B did no better than random thinning
([`../firmness-gate`](../firmness-gate/README.md)). Does a larger model that still runs locally,
`mlx-community/Qwen3.5-9B-MLX-4bit`, close the gap? It is used as both extractor and router, as in October's condition.

## Answer (dev split only: 8 meetings, 45 questions, 23 gold events; the smoke test, not held out)

- **Not on dev; it gets worse.** The 9B ledger answers **22/45** against the 4B's 35/45. On the same questions, 4 are
  right only with the 9B and 17 only with the 4B (exact sign test, p = 0.007).
- **Router:** it loses 8 questions to one format slip. For "What had been decided about X as of February 5, 2026?" it
  writes `"type":"as_of_tx"` with `"tx_at":null`, and October's validator rejects the route. With gold facts the 9B
  router scores 37/45 against 45/45 (0 vs 8, p = 0.008).
- **Extractor:** no better at what the answers need. With every route exact, the 9B ledger scores 28/45 against
  35/45 (4 vs 11, p = 0.12).
  - Its extraction scores are slightly higher: F1 37% vs 31%, precision 25% vs 21%, recall 70% vs 65%.
  - It writes fewer events (7.9 vs 9.1 per meeting), but more of its extra writes flip a value: 19 supersession links,
    1 of them right (4B: 10 links, 3 right).
  - Current-value and change-count answers depend on exactly those flips.
- **Review inbox** (perfect reviewer, open loop): 2.62 suggestions per meeting under `confirm_conflicts` (4B 2.12) and
  5.25 under `confirm_all` (4B 5.12). It does not shrink.
- **Cost on the same Mac:**
  - Time: 1.9× (115 s vs 61 s per meeting to extract; 6.3 s vs 3.4 s per question to route).
  - Memory: 2.1× (weights 5.04 vs 2.37 GB; process peak footprint 7.86 vs 5.24 GB).

On this evidence a 9B local model does not fix the ledger's bottleneck. Its remaining extraction errors are the same
kind as the 4B's: tentative, later or off-item remarks read as decisions. Its router is worse with October's prompt.
Whether the result holds on the test split is unknown.

## What was run

| Step (all from `research/local-9b`) | Model | Result |
|---|---|---|
| `run.py replay-october` | none | Today's engine reproduces October's dev, test and test-review runs from their caches: `REPLAY IDENTICAL` ×3 |
| `run.py check-4b` | 4B | 110 October test prompts (14 first-meeting windows, 96 routes): **110/110 replies identical**. The runtime (mlx 0.31.2, mlx-lm 0.31.3) is October's. 429 s |
| `run.py sanity` | 9B | 2 dev calls, both parsed by October's parsers. The window returned no event, as the 4B did in October for the same prompt. 35 s |
| `run.py run dev` (immediate policy) | 9B | **Complete:** 86 calls, 1,216 s by the `run_ami` timer (1,229 s with model load). `run.py replay dev` reproduces it with no model: `REPLAY IDENTICAL` |
| `run.py run dev-review` (`confirm_conflicts`, closed loop) | 9B | **Stopped by hand (memory pressure)** after ES2003, during TS3004. 15 new calls are in its cache; no result was written and none is used |
| `run.py run test`, `run test-review`, `burden test` | 9B | **Not run** |

Because the review run was stopped, both inbox policies are measured the open-loop way the firmness gate measured
`confirm_all`. Firmness-gate `replay.run` hands each meeting's candidates from the immediate run to a `confirm_conflicts`
or `confirm_all` ledger with October's perfect reviewer. I checked this measure on the test runs, where closed-loop
reviews exist:

| Test split | Open loop | Closed-loop reference |
|---|---|---|
| 4B, `confirm_conflicts` | 2.30 per meeting, 84/96 | 1.75, 85/96 |
| 4B, `confirm_all` | 4.95, 87/96 | 4.6, 88/96 (firmness gate) |
| DeepSeek, `confirm_conflicts` | 0.75, 89/96 | 0.80, 88/96 |
| DeepSeek, `confirm_all` | 3.1, 92/96 | 3.2, 92/96 |

## Setup

| | |
|---|---|
| Model | `mlx-community/Qwen3.5-9B-MLX-4bit` at `938d8919941c6e7efd3c7150eff7fe9d12afa631`, loaded from the local HF cache with `HF_HUB_OFFLINE=1` (no download). It has the same chat template and tokenizer as the 4B (`32f3e8e`), byte-compared |
| Only change | `memoria_engine.llmcache.CachingMLX` is replaced by `Local` (`run.py`), as `../strong-model/run.py` and October's `replay_offline.py` do. `Local` is October's CachingMLX with the same key and record, plus the revision and MLX peak memory per call; generation is October's `MLXExtractor.complete` |
| Unchanged | Extractor prompt v2 (`7f816362cd95`), router r1, 7,000-character windows, `max_tokens` 900 / 90, greedy decoding, `enable_thinking=False`. October's `run_ami.py`, scorer, `paired_sign_test`, `render_ami.py`. Firmness-gate `replay.run` for the inbox, strong-model `why()` for failures |
| Machine | Apple M5, 16 GB, macOS 26.7.1, Python 3.11.18, run on 2 November 2026 with other apps open |
| Hygiene | `PYTHONDONTWRITEBYTECODE=1` and `sys.dont_write_bytecode`: no `.pyc` was written under `src-tauri/resources/memory` or `research/` (checked). Nothing under `research/ledger-engine` or the engine was edited |

## Results (dev split, 45 questions, exact match; Wilson 95% on All)

| Ledger | Model | All | Current (16) | Past date (13) | Changes (16) |
|---|---|---|---|---|---|
| Extract + route | Qwen3.5-4B (October) | 35 (78%, 64–87) | 12 | 13 | 10 |
| Extract + route | **Qwen3.5-9B** | **22 (49%, 35–63)** | 11 | 5 | 6 |
| Extract + exact route (extractor only) | 4B / 9B | 35 / 28 | 12 / 11 | 13 / 11 | 10 / 6 |
| Gold facts + model route (router only) | 4B / 9B | 45 / 37 | 16 / 16 | 13 / 5 | 16 / 16 |
| Perfect reviewer, `confirm_conflicts` (open loop) | 4B / 9B | 36 / 28 | 12 / 14 | 13 / 5 | 11 / 9 |
| Perfect reviewer, `confirm_all` (open loop) | 4B / 9B | 38 / 30 | 11 / 11 | 13 / 5 | 14 / 14 |

DeepSeek was run only on the test split (82/96; the 4B scored 59/96 there) and the 9B only on dev, so no table puts
all three on the same questions.

**Paired exact sign test** (October `paired_sign_test`, two-sided, uncorrected; A = 9B, B = 4B):

| Comparison | A only right | B only right | Both | Neither | p |
|---|---|---|---|---|---|
| Ledger, all 45 | 4 | 17 | 18 | 6 | **0.007** |
| … current (16) | 3 | 4 | 8 | 1 | 1.000 |
| … past date (13) | 0 | 8 | 5 | 0 | 0.008 |
| … changes (16) | 1 | 5 | 5 | 5 | 0.219 |
| Extractor only (exact routes) | 4 | 11 | 24 | 6 | 0.118 |
| Router only (gold facts) | 0 | 8 | 37 | 0 | 0.008 |
| Perfect reviewer, `confirm_conflicts` / `confirm_all` | 3 / 2 | 11 / 10 | 25 / 28 | 6 / 5 | 0.057 / 0.039 |

**Extraction** against the 23 gold decisions (October scorer; bootstrap 95% over meetings):

| Extractor | TP | FN | FP | Written per meeting | Precision | Recall | F1 | Value-change links (right) | Items right at the end | Exact routes |
|---|---|---|---|---|---|---|---|---|---|---|
| Qwen3.5-4B (October) | 15 | 8 | 58 | 9.1 | 21% [12–33] | 65% [35–88] | 31% [20–46] | 10 (3) | 12/16 | 39/45, 0 unparsed |
| **Qwen3.5-9B** | 16 | 7 | 47 | 7.9 | 25% [15–38] | 70% [39–92] | 37% [22–52] | 19 (1) | 11/16 | 33/45, 8 unparsed |

**Review inbox**, perfect reviewer, 8 meetings (open loop; "drift" = meetings whose prompt beliefs would differ in a live run):

| Extractor | `confirm_conflicts` per meeting (total, max) | reviewer: rejected / accepted / edited | `confirm_all` per meeting (total, max) | reviewer: rejected / accepted / edited | Drift |
|---|---|---|---|---|---|
| Qwen3.5-4B (October) | 2.12 (17, 5) | 9 / 6 / 2 | 5.12 (41, 9) | 24 / 13 / 4 | 2, 4 |
| **Qwen3.5-9B** | 2.62 (21, 6) | 11 / 8 / 2 | 5.25 (42, 9) | 25 / 13 / 4 | 3, 5 |

## Cost: seconds and memory

| Dev split, generation time (prefill + decode), median (mean) | 4B (October, recorded) | 9B | 9B / 4B |
|---|---|---|---|
| Extraction, s per meeting (8 meetings, 41 windows) | 58.9 (61.4) | 110.9 (115.5) | 1.88 |
| Same prompts: first-meeting windows (5), s per window | 5.4 (5.9) | 10.0 (15.4) | 2.60 |
| Same prompts: routing, s per question (45) | 3.3 (3.4) | 5.9 (6.3) | 1.85 |
| Tokens in / out: extraction per meeting; routing per question | 14,975 / 993; 884 / 29 | 15,036 / 927; 884 / 39 | |
| Ledger run, wall clock (`run_ami` timer) | 648 s | 1,216 s | 1.88 |

First-meeting windows and router prompts are byte-identical for both models: nothing is believed before the first
meeting, and the router prompt never depends on the ledger. The 4B times were recorded in October. On the test split's
prompts, today's 4B ran within about 10% of them: windows 6.5 vs 7.2 s median, routes 3.3 vs 2.9 s.

### Memory: the practical finding

| GB | 4B | 9B |
|---|---|---|
| Weights in memory (MLX active after load) | 2.37 | 5.04 |
| MLX peak while reading a window (max over calls) | 3.99 | 6.58 |
| Process peak memory footprint (`/usr/bin/time -l`) | 5.24 | 7.86 |
| Process max RSS (`/usr/bin/time -l`; misses most GPU memory) | 1.26 | 1.36 |
| With the app's speech (1.82) and embedding (1.13) workers: weights only | 5.32 | 7.99 |
| … at the language model's MLX peak | 6.94 | 9.53 |
| … with the language model's process footprint | 8.18 | 10.80 |

The speech and embedding figures are the app's measured MLX memory as documented in `docs/MODEL-LIFECYCLE.md` on
2 November (commit `9229b757e`), when the speech worker ran MOSS and the embedding worker still held EmbeddingGemma's
audio and vision towers. That document gave the 4B as 2.368 GB, the same as this run's 2.37. With the 9B, Memoria's
three models would need about 8 GB at rest and 9.5–10.8 GB while the extractor reads. That leaves 5–6.5 GB of a 16 GB
Mac for macOS, the app's own window and everything else the user has open.

In this session other apps were open. At 22:26, during the 4B check, Edge, Microsoft Defender and a node process ran
at 40–55% CPU each, alongside Chrome, OpenCode and WindowServer. The system showed 15 GB used, 4.8 GB compressed and
126 MB free. During the 9B review run the Mac became unusable and the run was stopped. The 4B fits on a 16 GB Mac;
a 9B beside the speech and embedding models does not fit comfortably.

## Failures: what the 9B gets wrong that the 4B got right (17 of 45)

DeepSeek has no dev run and the 9B no test run, so the 9B's misses cannot be compared with DeepSeek's answers.
Below is the dev comparison with the 4B. Every quote is the evidence the 9B ledger stored. Full detail,
with value timelines, is in [`results/summary.md`](results/summary.md).

| Team, question | Slot | Gold | 9B | Why |
|---|---|---|---|---|
| ES2003 q9, q12, q15, q18, q21; TS3004 q7, q13, q16 | teletext, LCD ×2, battery ×2, case curve, case material ×2 | nothing decided by 5 Feb | route failed | **Router format:** `as_of_tx` with `"tx_at":null` for "What had been decided about … as of February 5, 2026?". The 4B chose `as_of_valid`. q18 and q21 would still be wrong: from meeting a's "make something … ergonomic, something that just fits" the 9B wrote case curve = single curved and case material = rubber, before anything was decided |
| ES2003 q17 | case curve, current | single curved | double curved | A later remark read as a decision: d turn 172, "I'd say we go two, 'cause like f the fanciest would be the double curved." It overwrote the single curved the 9B had written at turn 118 |
| ES2003 q23, q25 | colour, current / changes | special colour, 1 | yellow, 2 | A later remark after the special-colour decision: d "Well, it's kind of curved and we can make it yellow, and that's pretty much banana like." |
| TS3004 q5 | speech recognition, changes | 1 | 3 | Flip-flops within meeting c: "So they recommended using it." → included; "…We just we just skip the…" → excluded; "Okay, we just put it in, because it's a good feature." → included |
| TS3004 q11 | teletext, changes | 0 | 1 | A tentative remark: b "a teletext option, maybe we have to skip that one" → excluded, then included in the same meeting |
| TS3004 q12, q14 | battery, current / changes | rechargeable, 0 | conventional, 1 | A remark about their drawing read as a decision: d "We don't recharge." (next turn: "we didn't draw that too") |
| TS3004 q15, q17 | case material, current / changes | plastic, 0 | rubber, 2 | Off-item and reported remarks written as the case material: c "So rubber, kind of." (a fashion trend someone reported) and d "…with rubber buttons. Yeah, okay. Okay. Fine." (about the buttons). DeepSeek made the same buttons-for-case error on IS1009 (test) |

It fixes 4 of the 4B's 10 errors. It finds the €12.5 production cost (ES2003 q1) and the €25 price (q3, where the 4B
wrote 1.5 from a remark about the chip). It writes no spurious "single device" (TS3004 q2). It also keeps teletext
included (TS3004 q9), but by writing the 4B's "maybe … skip that one" and then reversing it, which costs q11.

The pattern is the 4B's, not a different one. Remarks that are not decisions still enter the ledger, and the 9B adds
more value flips within a meeting. A larger model of the same family does not supply what the firmness gate also
lacked: telling a firm decision from talk about one. DeepSeek reduced extra writes (116 → 56 on test); on dev the 9B
cut them only 58 → 47, and more of the ones it kept change a value.

## Threats to validity

- **Dev only.** 45 questions, 23 gold events, 2 teams. This is the smoke-test split, seen in October, and the paired
  differences are a handful of questions. No held-out claim is made.
- **October's prompts were written for the 4B.** By design only the model changes, so this measures the 9B with the
  4B's prompts. The router slip (`tx_at` left null) is that kind of cost: a prompt or a one-line parser default would
  probably absorb it. Even with every route exact, though, the 9B ledger is not better (28 vs 35).
- **Open-loop inbox.** Both policies are measured by replaying the immediate run's candidates (3 and 5 of 8 meetings
  drift for the 9B). On test, this measure was within 0.55 suggestions per meeting and 1 answer of the closed-loop runs.
- **Timing under load.** Other apps were busy during the runs (at 22:26: Edge, Defender and a node process at
  40–55% CPU each), and the 4B times were recorded in October. The same-day 4B check puts October's recorded times
  within about 10% of today's, so the 1.9× ratio is about right but not precise.
- **Memory.** MLX figures are per process. The speech and embedding figures are the app's measurements of 2 November,
  not remeasured. Adding a process footprint to MLX-active figures gives a lower bound on the total.
- **Gold** is derived from the AMI abstracts (the October caveat). It lists only decisions the annotators wrote down, so
  precision is a lower bound.

## Commands

From `research/local-9b`, `/opt/homebrew/bin/python3.11`, with `export PYTHONDONTWRITEBYTECODE=1`:

```sh
python3.11 run.py replay-october                                                          # no model
caffeinate -ims /usr/bin/time -l python3.11 -u run.py check-4b > logs/check_4b.log 2>&1   # 4B, 110 calls
caffeinate -ims /usr/bin/time -l python3.11 -u run.py sanity   > logs/sanity.log 2>&1     # 9B, 2 calls
caffeinate -ims /usr/bin/time -l python3.11 -u run.py run dev  > logs/dev.log 2>&1        # 9B, 86 calls, 1,229 s
caffeinate -ims /usr/bin/time -l python3.11 -u run.py run dev-review > logs/dev-review.log 2>&1   # stopped: memory pressure
python3.11 run.py replay dev      # no model: REPLAY IDENTICAL
python3.11 run.py render dev      # no model: results/qwen9b_dev_report.md (October format)
python3.11 summarize.py           # no model: results/summary.md, results/summary.json
```

Not run: `run.py run test`, `run.py run test-review`, `run.py burden test`. `summarize.py` adds the test split by itself
once `results/memoria_test.json` exists. At the dev rate, the test split would take about an hour on this Mac: about
49 minutes for the immediate run and about 12 for the review run. It needs the 9B snapshot back in place and enough
free memory.

## Files

| File | What it is |
|---|---|
| `run.py` | The model swap (`Local`), October replays, the 4B runtime check, sanity, runs, replay, burden, render |
| `summarize.py` | Tables, sign tests, inbox (open and closed loop), seconds and memory, failure analysis; no model |
| `cache/` | Every model call keyed by its prompt hash: `dev_memoria.jsonl` (86), `check_4b.jsonl` (110, 4B), `dev_sanity.jsonl` (2), and `dev_memoria_review.jsonl` (86 seeded + 15 from the stopped run, unused) |
| `results/` | `memoria_dev.json` (October format, plus `local_model`: revision, runtime, memory, call order), `check_4b.json`, `qwen9b_dev_report.md`, `summary.md`, `summary.json` |
| `logs/` | Run logs with `/usr/bin/time -l` (real time, max RSS, peak memory footprint); `dev-review.log` is partial |
