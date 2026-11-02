Split `test` (ES2004, ES2014, IS1009, TS3003, TS3007; 96 questions), model mlx-community/Qwen3.5-4B-MLX-4bit, windowed extraction (7000 characters per window), extractor prompt v2 7f816362cd95, router prompt r1. Run 2026-10-13 23:07:24.

### Question answering on real meetings (exact match; Wilson 95% interval)

| System | All | Current | As of a past date | How many changes |
|---|---|---|---|---|
| Memoria (LLM extractor + LLM router) | 61% [52-71] (59/96) | 53% [37-68] (18/34) | 100% [88-100] (29/29) | 36% [22-53] (12/33) |
| Memoria, oracle router (extraction errors only) | 61% [52-71] (59/96) | 53% [37-68] (18/34) | 100% [88-100] (29/29) | 36% [22-53] (12/33) |
| Memoria, oracle extractor (routing errors only) | 100% [96-100] (96/96) | 100% [90-100] (34/34) | 100% [88-100] (29/29) | 100% [90-100] (33/33) |
| full-context+cot | 43% [33-53] (41/96) | 71% [54-83] (24/34) | 21% [10-38] (6/29) | 33% [20-50] (11/33) |
| bm25-rag(k=12) | 39% [29-48] (37/96) | 65% [48-78] (22/34) | 48% [31-66] (14/29) | 3% [0-15] (1/33) |

### Paired comparison on the same questions (exact sign test)

| Memoria vs | Memoria only right | Baseline only right | Both right | Neither | p (two-sided) |
|---|---|---|---|---|---|
| full-context+cot | 34 | 16 | 25 | 21 | 0.015 |
| bm25-rag(k=12) | 31 | 9 | 28 | 28 | <0.001 |

Exploratory: small n, no correction for multiple comparisons.

### Extraction of decisions from the real meetings

| Gold events | Found (TP) | Missed (FN) | Extra (FP) | Precision | Recall | F1 |
|---|---|---|---|---|---|---|
| 46 | 31 | 15 | 116 | 21% | 67% | 32% |

Bootstrap 95% interval over meetings: {"precision": [0.138, 0.294], "recall": [0.487, 0.809], "f1": [0.22, 0.417]}.
Gold lists only the decisions the human annotators wrote down for the tracked items, so an extra prediction may be a true statement nobody listed: precision is a lower bound.

Miss reasons: {'missed': 6, 'value_error': 2, 'wrong_evidence': 7}. Extra-prediction reasons: {'wrong_content': 10, 'spurious': 106}. Evidence on the exact gold turn: 71% of found events (others inside the human-linked window).

| Team | Gold | TP | FN | FP | Recall |
|---|---|---|---|---|---|
| ES2004 | 6 | 3 | 3 | 17 | 50% |
| ES2014 | 14 | 10 | 4 | 34 | 71% |
| IS1009 | 7 | 5 | 2 | 14 | 71% |
| TS3003 | 11 | 5 | 6 | 12 | 45% |
| TS3007 | 8 | 8 | 0 | 39 | 100% |

Ledger state after the last meeting: 18/34 tracked items correct (53%); invented items (nothing decided but the ledger holds a value): 0. Supersession links: TP 2, FP 39, FN 2.

### Router and cost

Question to ledger lookup: exact route 81/96, failed to parse 0, 2.998 s and 859.708 prompt tokens per question.

| System | Median s / question | Mean prompt tokens | Mean output tokens |
|---|---|---|---|
| Memoria (ledger lookup, after ingestion) | 2.998 | 859.708 | - |
| full-context+cot | 84.19 | 34258 | 449 |
| bm25-rag(k=12) | 3.41 | 2465 | 2 |

Memoria pays once per meeting at ingestion: 63.198 s, 14373.5 prompt tokens and 5.15 windows per meeting on average (20 meetings, 1264.0 s in total).

### Where Memoria was wrong (37 of 96)

| Team | Question | Gold | Memoria | Oracle extractor right? | Route exact? |
|---|---|---|---|---|---|
| ES2004 | Currently, what has been decided about the battery type of the remote? | kinetic | rechargeable | yes | yes |
| ES2004 | How many times has the decision about the battery type of the remote c | 1 | 2 | yes | yes |
| ES2004 | Currently, what has been decided about whether the remote has Video Pl | included | excluded | yes | yes |
| ES2004 | Currently, what has been decided about whether the remote comes with a | included | excluded | yes | yes |
| ES2004 | How many times has the decision about whether the remote comes with a  | 0 | 1 | yes | yes |
| ES2004 | Currently, what has been decided about the colours of the LCD screen? | black and white | full colour | yes | yes |
| ES2004 | How many times has the decision about the colours of the LCD screen ch | 0 | 3 | yes | yes |
| ES2014 | Currently, what has been decided about whether the remote has a panel  | included | excluded | yes | yes |
| ES2014 | How many times has the decision about whether the remote has a panel h | 0 | 1 | yes | yes |
| ES2014 | Currently, what has been decided about whether the remote has speech r | included | excluded | yes | yes |
| ES2014 | How many times has the decision about whether the remote has speech re | 0 | 3 | yes | yes |
| ES2014 | How many times has the decision about the power source of the remote c | 0 | 2 | yes | yes |
| ES2014 | How many times has the decision about which chip the remote uses chang | 0 | 1 | yes | yes |
| ES2014 | Currently, what has been decided about the material of the remote's ca | plastic | rubber | yes | yes |
| ES2014 | How many times has the decision about the material of the remote's cas | 1 | 2 | yes | yes |
| ES2014 | Currently, what has been decided about which type of buttons the remot | push buttons | scroll buttons | yes | yes |
| ES2014 | How many times has the decision about which type of buttons the remote | 0 | 1 | yes | yes |
| IS1009 | Currently, what has been decided about the selling price of the remote | 25 | None | yes | yes |
| IS1009 | Currently, what has been decided about the power source of the remote? | batteries | kinetic | yes | yes |
| IS1009 | How many times has the decision about the power source of the remote c | 0 | 2 | yes | yes |
| IS1009 | Currently, what has been decided about the material of the remote's ca | plastic | rubber | yes | yes |
| IS1009 | How many times has the decision about the material of the remote's cas | 0 | 1 | yes | yes |
| TS3003 | Currently, what has been decided about the maximum production cost of  | 12.5 | 23 | yes | yes |
| TS3003 | How many times has the decision about the maximum production cost of t | 0 | 2 | yes | yes |
| TS3003 | Currently, what has been decided about which devices the remote contro | multiple devices | televisions only | yes | yes |
| TS3003 | Currently, what has been decided about whether the remote has a dockin | included | excluded | yes | yes |
| TS3003 | How many times has the decision about whether the remote has a docking | 0 | 1 | yes | yes |
| TS3003 | How many times has the decision about which chip the remote uses chang | 0 | 1 | yes | yes |
| TS3003 | How many times has the decision about the material of the remote's cas | 0 | 1 | yes | yes |
| TS3007 | Currently, what has been decided about the energy source of the remote | battery only | batteries and kinetic | yes | yes |
| TS3007 | How many times has the decision about the energy source of the remote  | 1 | 4 | yes | yes |
| TS3007 | Currently, what has been decided about the curvature of the remote's c | single curved | double curved | yes | yes |
| TS3007 | How many times has the decision about the curvature of the remote's ca | 1 | 3 | yes | yes |
| TS3007 | How many times has the decision about the material of the remote's cas | 0 | 2 | yes | yes |
| TS3007 | How many times has the decision about whether the remote has a touch s | 0 | 3 | yes | yes |
| TS3007 | How many times has the decision about whether the remote has speech re | 0 | 1 | yes | yes |
| TS3007 | How many times has the decision about whether the remote includes game | 0 | 2 | yes | yes |
