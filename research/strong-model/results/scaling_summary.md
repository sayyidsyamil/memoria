## Growth experiment: synthetic test chains padded with K filler meetings (37 questions)

| Method | Model | K=0 | K=24 | K=48 |
|---|---|---|---|---|
| Meetings per chain (mean) |  | 3.7 | 27.7 | 51.7 |
| Tracked items per chain (mean) |  | 3.0 | 12.7 | 20.0 |
| Ledger (extract + route) | Qwen3.5-4B, October | 28 (76%) | 26 (70%) | 24 (65%) |
| Ledger (extract + route) | DeepSeek V4.1 Flash | 37 (100%) | 37 (100%) | 36 (97%) |
| Ledger, gold facts (router only) | DeepSeek V4.1 Flash | 37 (100%) | 37 (100%) | 37 (100%) |
| Full context + CoT | Qwen3.5-4B, October | 23 (62%) | 24 (65%) | 23 (62%) |
| Full context + CoT | DeepSeek V4.1 Flash | 32 (86%) | 30 (81%) | 34 (92%) |
| BM25 k=12 (not rerun) | Qwen3.5-4B, October | 22 (59%) | 17 (46%) | 13 (35%) |

Paired exact sign test (October `paired_sign_test`, same 37 questions; exploratory, no correction):

| K | A vs B | Model | A only right | B only right | Both | Neither | p (two-sided) |
|---|---|---|---|---|---|---|---|
| 0 | Ledger vs full context | DeepSeek | 5 | 0 | 32 | 0 | 0.062 |
| 0 | Ledger vs full context | Qwen, October | 11 | 6 | 17 | 3 | 0.332 |
| 24 | Ledger vs full context | DeepSeek | 7 | 0 | 30 | 0 | 0.016 |
| 24 | Ledger vs full context | Qwen, October | 9 | 7 | 17 | 4 | 0.804 |
| 48 | Ledger vs full context | DeepSeek | 3 | 1 | 33 | 0 | 0.625 |
| 48 | Ledger vs full context | Qwen, October | 8 | 7 | 16 | 6 | 1.000 |
| 0 vs 48 | Ledger at K=0 vs K=48 | DeepSeek | 1 | 0 | 36 | 0 | 1.000 |
| 0 vs 48 | Ledger at K=0 vs K=48 | Qwen, October | 4 | 0 | 24 | 9 | 0.125 |
| 0 vs 48 | Full context at K=0 vs K=48 | DeepSeek | 2 | 4 | 30 | 1 | 0.688 |
| 0 vs 48 | Full context at K=0 vs K=48 | Qwen, October | 5 | 5 | 18 | 9 | 1.000 |

By question type:

| K | System | Current | Past date | As recorded on a date | Changes |
|---|---|---|---|---|---|
| 0 | Ledger, DeepSeek | 12/12 | 16/16 | 4/4 | 5/5 |
| 0 | Full context, DeepSeek | 11/12 | 14/16 | 3/4 | 4/5 |
| 0 | Ledger, Qwen (Oct) | 10/12 | 11/16 | 2/4 | 5/5 |
| 0 | Full context, Qwen (Oct) | 8/12 | 12/16 | 3/4 | 0/5 |
| 48 | Ledger, DeepSeek | 12/12 | 16/16 | 3/4 | 5/5 |
| 48 | Full context, DeepSeek | 11/12 | 14/16 | 4/4 | 5/5 |
| 48 | Ledger, Qwen (Oct) | 8/12 | 10/16 | 2/4 | 4/5 |
| 48 | Full context, Qwen (Oct) | 5/12 | 13/16 | 3/4 | 2/5 |

Cost, tokens and latency with DeepSeek (measured = `usage.cost`, cache discounts included; list = same tokens, no cache; seconds = median wall time). Qwen column: October, Apple M5.

| K | Step | DeepSeek measured | DeepSeek list, no cache | Tokens in / out | DeepSeek s | Qwen s (Oct) | Note |
|---|---|---|---|---|---|---|---|
| 0 | Ledger: read a meeting | $0.00026 | $0.00026 | 1,050 / 170 | 2.5 | 5.3 (mean) | 11 meetings read; 0 outputs truncated |
| 0 | Ledger: answer a question | $0.000061 | $0.000135 | 771 / 32 | 1.4 | 2.2 (mean) | all-in $0.00014 per question (11 meetings, 37 questions) |
| 0 | Full context + CoT: answer a question | $0.00011 | $0.00020 | 866 / 110 | 2.5 | 6.7 (median); 904 / 255 tokens | 547 input tokens per question from the provider cache; 0 truncated at 4096 (Qwen: 1) |
| 24 | Ledger: read a meeting | $0.00023 | $0.00028 | 1,444 / 105 | 1.9 | 5.5 (mean) | 83 meetings read; 0 outputs truncated |
| 24 | Ledger: answer a question | $0.000041 | $0.000174 | 1,030 / 32 | 1.2 | 3.3 (mean) | all-in $0.00055 per question (83 meetings, 37 questions) |
| 24 | Full context + CoT: answer a question | $0.00022 | $0.00067 | 3,944 / 132 | 2.0 | 18.3 (median); 4,273 / 887 tokens | 3,024 input tokens per question from the provider cache; 0 truncated at 4096 (Qwen: 6) |
| 48 | Ledger: read a meeting | $0.00024 | $0.00032 | 1,752 / 99 | 1.7 | 6.8 (mean) | 155 meetings read; 0 outputs truncated |
| 48 | Ledger: answer a question | $0.000049 | $0.000204 | 1,229 / 32 | 1.3 | 4.1 (mean) | all-in $0.00104 per question (155 meetings, 37 questions) |
| 48 | Full context + CoT: answer a question | $0.00031 | $0.00112 | 6,978 / 120 | 2.2 | 27.9 (median); 7,596 / 937 tokens | 5,494 input tokens per question from the provider cache; 0 truncated at 4096 (Qwen: 5) |
