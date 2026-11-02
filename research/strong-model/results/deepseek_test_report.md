Split `test` (ES2004, ES2014, IS1009, TS3003, TS3007; 96 questions), model deepseek/deepseek-v4.1-flash-1017, windowed extraction (7000 characters per window), extractor prompt v2 7f816362cd95, router prompt r1. Run 2026-11-02 20:46:44.

### Question answering on real meetings (exact match; Wilson 95% interval)

| System | All | Current | As of a past date | How many changes |
|---|---|---|---|---|
| Memoria (LLM extractor + LLM router) | 85% [77-91] (82/96) | 85% [70-94] (29/34) | 97% [83-99] (28/29) | 76% [59-87] (25/33) |
| Memoria, oracle router (extraction errors only) | 85% [77-91] (82/96) | 85% [70-94] (29/34) | 97% [83-99] (28/29) | 76% [59-87] (25/33) |
| Memoria, oracle extractor (routing errors only) | 100% [96-100] (96/96) | 100% [90-100] (34/34) | 100% [88-100] (29/29) | 100% [90-100] (33/33) |
| full-context+cot | 84% [76-90] (81/96) | 88% [73-95] (30/34) | 83% [66-92] (24/29) | 82% [66-91] (27/33) |
| bm25-rag(k=12) | 73% [63-81] (70/96) | 56% [40-71] (19/34) | 100% [88-100] (29/29) | 67% [50-80] (22/33) |

### Paired comparison on the same questions (exact sign test)

| Memoria vs | Memoria only right | Baseline only right | Both right | Neither | p (two-sided) |
|---|---|---|---|---|---|
| full-context+cot | 10 | 9 | 72 | 5 | 1.000 |
| bm25-rag(k=12) | 19 | 7 | 63 | 7 | 0.029 |

Exploratory: small n, no correction for multiple comparisons.

### Extraction of decisions from the real meetings

| Gold events | Found (TP) | Missed (FN) | Extra (FP) | Precision | Recall | F1 |
|---|---|---|---|---|---|---|
| 46 | 35 | 11 | 56 | 38% | 76% | 51% |

Bootstrap 95% interval over meetings: {"precision": [0.296, 0.477], "recall": [0.625, 0.898], "f1": [0.416, 0.595]}.
Gold lists only the decisions the human annotators wrote down for the tracked items, so an extra prediction may be a true statement nobody listed: precision is a lower bound.

Miss reasons: {'missed': 8, 'wrong_evidence': 3}. Extra-prediction reasons: {'spurious': 53, 'wrong_content': 3}. Evidence on the exact gold turn: 77% of found events (others inside the human-linked window).

| Team | Gold | TP | FN | FP | Recall |
|---|---|---|---|---|---|
| ES2004 | 6 | 5 | 1 | 13 | 83% |
| ES2014 | 14 | 10 | 4 | 15 | 71% |
| IS1009 | 7 | 7 | 0 | 8 | 100% |
| TS3003 | 11 | 5 | 6 | 8 | 45% |
| TS3007 | 8 | 8 | 0 | 12 | 100% |

Ledger state after the last meeting: 29/34 tracked items correct (85%); invented items (nothing decided but the ledger holds a value): 0. Supersession links: TP 3, FP 12, FN 1.

### Router and cost

Question to ledger lookup: exact route 67/96, failed to parse 0, 2.941 s and 817.833 prompt tokens per question.

| System | Median s / question | Mean prompt tokens | Mean output tokens |
|---|---|---|---|
| Memoria (ledger lookup, after ingestion) | 2.941 | 817.833 | - |
| full-context+cot | 5.71 | 31337 | 215 |
| bm25-rag(k=12) | 1.35 | 2291 | 3 |

Memoria pays once per meeting at ingestion: 15.381 s, 13430.5 prompt tokens and 5.15 windows per meeting on average (20 meetings, 307.6 s in total).

### Where Memoria was wrong (14 of 96)

| Team | Question | Gold | Memoria | Oracle extractor right? | Route exact? |
|---|---|---|---|---|---|
| ES2004 | Currently, what has been decided about the battery type of the remote? | kinetic | conventional | yes | yes |
| ES2004 | How many times has the decision about the battery type of the remote c | 1 | 3 | yes | yes |
| ES2004 | Currently, what has been decided about whether the remote has Video Pl | included | None | yes | yes |
| ES2004 | What had been decided about the colours of the LCD screen as of Februa | None | black and white | yes | no |
| ES2014 | How many times has the decision about whether the remote has speech re | 0 | 1 | yes | yes |
| ES2014 | How many times has the decision about the material of the remote's cas | 1 | 3 | yes | yes |
| ES2014 | How many times has the decision about the curvature of the remote's ca | 0 | 1 | yes | yes |
| IS1009 | Currently, what has been decided about the material of the remote's ca | plastic | rubber | yes | yes |
| IS1009 | How many times has the decision about the material of the remote's cas | 0 | 1 | yes | yes |
| IS1009 | How many times has the decision about the material of the remote's but | 0 | 1 | yes | yes |
| TS3003 | Currently, what has been decided about which devices the remote contro | multiple devices | televisions only | yes | yes |
| TS3003 | How many times has the decision about whether the remote has an LCD sc | 0 | 1 | yes | yes |
| TS3003 | Currently, what has been decided about whether the remote has a dockin | included | excluded | yes | yes |
| TS3003 | How many times has the decision about whether the remote has a docking | 0 | 1 | yes | yes |
