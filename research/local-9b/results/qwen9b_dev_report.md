Split `dev` (ES2003, TS3004; 45 questions), model mlx-community/Qwen3.5-9B-MLX-4bit, windowed extraction (7000 characters per window), extractor prompt v2 7f816362cd95, router prompt r1. Run 2026-11-02 22:32:59.

### Question answering on real meetings (exact match; Wilson 95% interval)

| System | All | Current | As of a past date | How many changes |
|---|---|---|---|---|
| Memoria (LLM extractor + LLM router) | 49% [35-63] (22/45) | 69% [44-86] (11/16) | 38% [18-64] (5/13) | 38% [18-61] (6/16) |
| Memoria, oracle router (extraction errors only) | 62% [48-75] (28/45) | 69% [44-86] (11/16) | 85% [58-96] (11/13) | 38% [18-61] (6/16) |
| Memoria, oracle extractor (routing errors only) | 82% [69-91] (37/45) | 100% [81-100] (16/16) | 38% [18-64] (5/13) | 100% [81-100] (16/16) |

### Extraction of decisions from the real meetings

| Gold events | Found (TP) | Missed (FN) | Extra (FP) | Precision | Recall | F1 |
|---|---|---|---|---|---|---|
| 23 | 16 | 7 | 47 | 25% | 70% | 37% |

Bootstrap 95% interval over meetings: {"precision": [0.154, 0.375], "recall": [0.391, 0.923], "f1": [0.225, 0.519]}.
Gold lists only the decisions the human annotators wrote down for the tracked items, so an extra prediction may be a true statement nobody listed: precision is a lower bound.

Miss reasons: {'wrong_evidence': 4, 'missed': 3}. Extra-prediction reasons: {'spurious': 47}. Evidence on the exact gold turn: 56% of found events (others inside the human-linked window).

| Team | Gold | TP | FN | FP | Recall |
|---|---|---|---|---|---|
| ES2003 | 13 | 10 | 3 | 21 | 77% |
| TS3004 | 10 | 6 | 4 | 26 | 60% |

Ledger state after the last meeting: 11/16 tracked items correct (69%); invented items (nothing decided but the ledger holds a value): 0. Supersession links: TP 1, FP 18, FN 4.

### Router and cost

Question to ledger lookup: exact route 33/45, failed to parse 8, 6.339 s and 884.444 prompt tokens per question.

| System | Median s / question | Mean prompt tokens | Mean output tokens |
|---|---|---|---|
| Memoria (ledger lookup, after ingestion) | 6.339 | 884.444 | - |

Memoria pays once per meeting at ingestion: 115.475 s, 15036.125 prompt tokens and 5.125 windows per meeting on average (8 meetings, 923.8 s in total).

### Where Memoria was wrong (23 of 45)

| Team | Question | Gold | Memoria | Oracle extractor right? | Route exact? |
|---|---|---|---|---|---|
| ES2003 | What had been decided about whether the remote has teletext as of Febr | None | <route failed> | no | no |
| ES2003 | What had been decided about whether the remote has an LCD screen as of | None | <route failed> | no | no |
| ES2003 | How many times has the decision about whether the remote has an LCD sc | 0 | 1 | yes | yes |
| ES2003 | What had been decided about the battery type of the remote as of Febru | None | <route failed> | no | no |
| ES2003 | How many times has the decision about the battery type of the remote c | 0 | 1 | yes | yes |
| ES2003 | Currently, what has been decided about the curvature of the remote's c | single curved | double curved | yes | yes |
| ES2003 | What had been decided about the curvature of the remote's case as of F | None | <route failed> | no | no |
| ES2003 | How many times has the decision about the curvature of the remote's ca | 1 | 3 | yes | yes |
| ES2003 | What had been decided about the material of the remote's case as of Fe | None | <route failed> | no | no |
| ES2003 | Currently, what has been decided about the colour of the remote? | special colour | yellow | yes | yes |
| ES2003 | How many times has the decision about the colour of the remote changed | 1 | 2 | yes | yes |
| TS3004 | Currently, what has been decided about what kind of remote it is? | universal | None | yes | yes |
| TS3004 | How many times has the decision about whether the remote has speech re | 1 | 3 | yes | yes |
| TS3004 | What had been decided about whether the remote has an LCD screen as of | None | <route failed> | no | no |
| TS3004 | How many times has the decision about whether the remote has an LCD sc | 0 | 4 | yes | yes |
| TS3004 | How many times has the decision about whether the remote has teletext  | 0 | 1 | yes | yes |
| TS3004 | Currently, what has been decided about the battery type of the remote? | rechargeable | conventional | yes | yes |
| TS3004 | What had been decided about the battery type of the remote as of Febru | None | <route failed> | no | no |
| TS3004 | How many times has the decision about the battery type of the remote c | 0 | 1 | yes | yes |
| TS3004 | Currently, what has been decided about the material of the remote's ca | plastic | rubber | yes | yes |
| TS3004 | What had been decided about the material of the remote's case as of Fe | None | <route failed> | no | no |
| TS3004 | How many times has the decision about the material of the remote's cas | 0 | 2 | yes | yes |
| TS3004 | How many times has the decision about the colour of the remote changed | 1 | 0 | yes | yes |
