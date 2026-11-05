Split `test` (ES2004, ES2014, IS1009, TS3003, TS3007; 96 questions), model mlx-community/Qwen3.5-4B-MLX-4bit, windowed extraction (7000 characters per window), extractor prompt v2 7f816362cd95, router prompt r1. Run 2026-10-14 02:02:53.

### Question answering on real meetings (exact match; Wilson 95% interval)

| System | All | Current | As of a past date | How many changes |
|---|---|---|---|---|
| Memoria (LLM extractor + LLM router) | 89% [81-94] (85/96) | 85% [70-94] (29/34) | 100% [88-100] (29/29) | 82% [66-91] (27/33) |
| Memoria, oracle router (extraction errors only) | 89% [81-94] (85/96) | 85% [70-94] (29/34) | 100% [88-100] (29/29) | 82% [66-91] (27/33) |
| Memoria, oracle extractor (routing errors only) | 100% [96-100] (96/96) | 100% [90-100] (34/34) | 100% [88-100] (29/29) | 100% [90-100] (33/33) |

### Extraction of decisions from the real meetings

| Gold events | Found (TP) | Missed (FN) | Extra (FP) | Precision | Recall | F1 |
|---|---|---|---|---|---|---|
| 46 | 33 | 13 | 114 | 22% | 72% | 34% |

Bootstrap 95% interval over meetings: {"precision": [0.142, 0.338], "recall": [0.577, 0.827], "f1": [0.232, 0.465]}.
Gold lists only the decisions the human annotators wrote down for the tracked items, so an extra prediction may be a true statement nobody listed: precision is a lower bound.

Miss reasons: {'missed': 3, 'value_error': 2, 'wrong_evidence': 7, 'link_error': 1}. Extra-prediction reasons: {'wrong_content': 11, 'spurious': 103}. Evidence on the exact gold turn: 73% of found events (others inside the human-linked window).

| Team | Gold | TP | FN | FP | Recall |
|---|---|---|---|---|---|
| ES2004 | 6 | 3 | 3 | 23 | 50% |
| ES2014 | 14 | 10 | 4 | 29 | 71% |
| IS1009 | 7 | 5 | 2 | 8 | 71% |
| TS3003 | 11 | 7 | 4 | 15 | 64% |
| TS3007 | 8 | 8 | 0 | 39 | 100% |

Ledger state after the last meeting: 29/34 tracked items correct (85%); invented items (nothing decided but the ledger holds a value): 0. Supersession links: TP 2, FP 6, FN 2.

### Router and cost

Question to ledger lookup: exact route 81/96, failed to parse 0, 2.998 s and 859.708 prompt tokens per question.

| System | Median s / question | Mean prompt tokens | Mean output tokens |
|---|---|---|---|
| Memoria (ledger lookup, after ingestion) | 2.998 | 859.708 | - |

Memoria pays once per meeting at ingestion: 55.566 s, 14372.8 prompt tokens and 5.15 windows per meeting on average (20 meetings, 1111.3 s in total).

### Where Memoria was wrong (11 of 96)

| Team | Question | Gold | Memoria | Oracle extractor right? | Route exact? |
|---|---|---|---|---|---|
| ES2004 | Currently, what has been decided about the battery type of the remote? | kinetic | rechargeable | yes | yes |
| ES2004 | How many times has the decision about the battery type of the remote c | 1 | 0 | yes | yes |
| ES2004 | Currently, what has been decided about whether the remote has Video Pl | included | excluded | yes | yes |
| ES2014 | How many times has the decision about which chip the remote uses chang | 0 | 1 | yes | yes |
| IS1009 | Currently, what has been decided about the selling price of the remote | 25 | None | yes | yes |
| IS1009 | Currently, what has been decided about the power source of the remote? | batteries | solar | yes | yes |
| TS3003 | Currently, what has been decided about which devices the remote contro | multiple devices | televisions only | yes | yes |
| TS3003 | How many times has the decision about which chip the remote uses chang | 0 | 1 | yes | yes |
| TS3007 | How many times has the decision about the curvature of the remote's ca | 1 | 2 | yes | yes |
| TS3007 | How many times has the decision about whether the remote has a touch s | 0 | 1 | yes | yes |
| TS3007 | How many times has the decision about whether the remote has speech re | 0 | 1 | yes | yes |
