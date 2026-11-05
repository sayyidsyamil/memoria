# Language-model bake-off (November 2026)

Should the app's resident language model (Qwen3.5-4B, 4-bit MLX) be replaced by a newer local
model? Three newer MLX models that fit beside the speech and embedding models on a 16 GB Mac
were run through the app's own code, one at a time with the app quit
(`scripts/model_bakeoff.sh`, `MEMORIA_LLM_MODEL`), on two tasks:

- **UAT demo extraction:** the three fictional steering-committee meetings of the user
  acceptance test, taken in through the app's tracked-fact extraction (with its grounded repairs)
  and scored against `research/ledger-engine/data/demo/answer_key.md` (15 value-changing events).
- **Live check, MemoriaBench dev split:** 60 probes (20 conflicts, 40 must-not-alert), the app's
  verifier and guard (`research/memoriabench/app_live_check_bench.py --split dev`). Model
  selection uses the dev split only; the test split stays for the reported score.

| Model (4-bit MLX) | Memory | Demo: correct / proposed | Gold events found | Dev recall | Dev false alarms | Uncertain | p50 latency |
|---|---|---|---|---|---|---|---|
| **Qwen3.5-4B** (current) | 2.4 GB | **17 / 17** | **15 / 15** | **70%** (14/20) | 7.5% (3/40) | 2 | 5.5 s |
| Qwen3.5-9B | 5.0 GB | 18 / 21 | 15 / 15 | 50% (10/20) | 0% | 1 | 9.5 s |
| LFM2.5-8B-A1B (MoE) | 4.8 GB | 0 / 0 | 0 / 15 | 0% | 0% | 45 | 14.0 s |
| Gemma-4-E4B | 4.2 GB | 10 / 10 | 9 / 15 | 25% (5/20) | 0% | 25 | 2.8 s |

**Decision: keep Qwen3.5-4B.** It is the only model that found every demo event with no wrong
value and caught most dev conflicts. Qwen3.5-9B was more cautious (no false alarm, half the
conflicts), twice as slow, twice the memory, and invented a "cancelled" status for two open
commitments (three wrong proposals, a confident wrong value in UAT terms). LFM2.5 and Gemma-4
mostly failed the app's structured output formats (extraction JSON, verifier verdicts), which
shows up as no proposals and many "uncertain" checks; they would need prompt and parser work
before a fair comparison. The dev split is small (60 probes). The 4B's test-split results are in
`../memoriabench/APP_LIVE_CHECK.md` (the check of 2 November, as run here) and
`../live-verifier/README.md` (the check of `v0.3.0-uat`).

Files: `*.demo.json` (proposals against the answer key), `*.dev.jsonl` and
`*.dev.summary.json` (live-check predictions and summary per model). Run on 2 November 2026,
MacBook Pro M5, 16 GB.
