## Question answering, AMI test split (96 questions, exact match)

| Method | Model | All | Current | Value on a past date | Number of changes |
|---|---|---|---|---|---|
| Ledger (extract + route) | Qwen3.5-4B (Oct, local) | 59/96 (61%) | 18/34 | 29/29 | 12/33 |
| Ledger (extract + route) | DeepSeek V4.1 Flash | 82/96 (85%) | 29/34 | 28/29 | 25/33 |
| Full context + CoT | Qwen3.5-4B (Oct, local) | 41/96 (43%) | 24/34 | 6/29 | 11/33 |
| Full context + CoT | DeepSeek V4.1 Flash | 81/96 (84%) | 30/34 | 24/29 | 27/33 |
| BM25 k=12 | Qwen3.5-4B (Oct, local) | 37/96 (39%) | 22/34 | 14/29 | 1/33 |
| BM25 k=12 | DeepSeek V4.1 Flash | 70/96 (73%) | 19/34 | 29/29 | 22/33 |
| Ledger, gold facts (router only) | Qwen3.5-4B (Oct, local) | 96/96 (100%) | 34/34 | 29/29 | 33/33 |
| Ledger, gold facts (router only) | DeepSeek V4.1 Flash | 96/96 (100%) | 34/34 | 29/29 | 33/33 |
| Ledger + oracle reviewer (upper bound) | Qwen3.5-4B (Oct, local) | 85/96 (89%) | 29/34 | 29/29 | 27/33 |
| Ledger + oracle reviewer (upper bound) | DeepSeek V4.1 Flash | 88/96 (92%) | 31/34 | 28/29 | 29/33 |

## Paired exact sign test (October `paired_sign_test`, same 96 questions)

| A vs B | Model | A only right | B only right | Both | Neither | p (two-sided) |
|---|---|---|---|---|---|---|
| Ledger vs full context + CoT | Qwen3.5-4B (Oct, local) | 34 | 16 | 25 | 21 | 0.015 |
| Ledger vs BM25 k=12 | Qwen3.5-4B (Oct, local) | 31 | 9 | 28 | 28 | <0.001 |
| Ledger vs full context + CoT | DeepSeek V4.1 Flash | 10 | 9 | 72 | 5 | 1.000 |
| Ledger vs BM25 k=12 | DeepSeek V4.1 Flash | 19 | 7 | 63 | 7 | 0.029 |
| Ledger DeepSeek vs ledger Qwen (better extractor) | both | 27 | 4 | 55 | 10 | <0.001 |
| Full context DeepSeek vs ledger Qwen (exploratory) | both | 31 | 9 | 50 | 6 | <0.001 |

Exploratory: one run, 96 questions, no correction for multiple comparisons.

By question type, DeepSeek ledger (A) vs the DeepSeek baseline (B):

| B | Type | A only right | B only right | Both | Neither | p (two-sided) |
|---|---|---|---|---|---|---|
| full context + CoT | Current | 2 | 3 | 27 | 2 | 1.000 |
| full context + CoT | Value on a past date | 5 | 1 | 23 | 0 | 0.219 |
| full context + CoT | Number of changes | 3 | 5 | 22 | 3 | 0.727 |
| BM25 k=12 | Current | 12 | 2 | 17 | 3 | 0.013 |
| BM25 k=12 | Value on a past date | 0 | 1 | 28 | 0 | 1.000 |
| BM25 k=12 | Number of changes | 7 | 4 | 18 | 4 | 0.549 |

## Extraction against the 46 gold decisions (October scorer; bootstrap 95% interval over meetings)

| Extractor | Gold | TP | FN | FP | Precision | Recall | F1 | Miss reasons | Extra reasons |
|---|---|---|---|---|---|---|---|---|---|
| Qwen3.5-4B (Oct, local) | 46 | 31 | 15 | 116 | 21% [14-29] | 67% [49-81] | 32% [22-42] | {"missed": 6, "value_error": 2, "wrong_evidence": 7} | {"wrong_content": 10, "spurious": 106} |
| DeepSeek V4.1 Flash | 46 | 35 | 11 | 56 | 38% [30-48] | 76% [62-90] | 51% [42-60] | {"missed": 8, "wrong_evidence": 3} | {"spurious": 53, "wrong_content": 3} |

## Review inbox (policy confirm_conflicts, October oracle reviewer) and ledger state

| Extractor | Proposals per meeting (mean) | Max in one meeting | Total (20 meetings) | Oracle reviewer | Items right after last meeting (immediate) | Supersession links (immediate) |
|---|---|---|---|---|---|---|
| Qwen3.5-4B (Oct, local) | 1.75 | 10 | 35 | {"rejected": 22, "accepted_edited": 5, "accepted": 8} | 18/34 | TP 2, FP 39, FN 2 |
| DeepSeek V4.1 Flash | 0.80 | 3 | 16 | {"rejected": 7, "accepted": 9} | 29/34 | TP 3, FP 12, FN 1 |

Router: exact lookup 67/96 with DeepSeek (0 unparsed) vs 81/96 with Qwen (0 unparsed).

## Cost, latency and tokens (DeepSeek via OpenRouter, StreamLake endpoint; October Qwen3.5-4B on an Apple M5, no money cost)

Measured cost = sum of `usage.cost` of the responses (prompt-cache discounts included); list price = the same tokens at $0.15 / $0.60 per million with no cache. Seconds = median (mean) wall time per unit; for a meeting, the sum of its windows.

| Method | Per | DeepSeek cost (measured) | DeepSeek cost (list, no cache) | DeepSeek s | DeepSeek tokens in / out | Qwen s (Oct) | Qwen tokens in / out (Oct) |
|---|---|---|---|---|---|---|---|
| Ledger: read a meeting (once, at ingestion) | meeting | $0.00189 | $0.00222 | 13.9 (15.4) | 13,430 / 347 | 63.2 (mean) | 14,374 / 836 |
| Ledger: answer (router + lookup) | question | $0.000034 | $0.000142 | 2.6 (2.9) | 818 / 32 | 2.9 (3.0) | 860 / 30 |
| Ledger, all-in on this test set (20 meetings read, 96 questions) | question | $0.00043 | $0.00060 | - | 3,616 / 104 | - | 3,854 / 204 |
| Full context + CoT | question | $0.00048 | $0.00483 | 5.7 (6.1) | 31,337 / 215 | 84.2 (88.2) | 34,258 / 449 |
| BM25 k=12 | question | $0.00031 | $0.00035 | 1.3 (2.0) | 2,291 / 3 | 3.4 (3.4) | 2,465 / 2 |

Provider cache: full context read 29,523 of 31,337 input tokens per question from the cache (the 19 questions of a team share one transcript prefix); BM25 189 of 2,291. Outputs cut at max_tokens: full context 0 (cap 4096), BM25 3 (cap 24).

## Where the DeepSeek ledger is still wrong (14 of 96)

Causes: {"wrong value in force": 4, "spurious change (extra value written)": 8, "extraction miss (no value in the ledger)": 1, "decision recorded before it was made": 1}. Of Qwen's 37 wrong answers DeepSeek fixes 27, keeps 10; it gets 4 wrong that Qwen got right. Timeline = the values the ledger holds, by meeting letter (a-d).

| Team | Q | Type | Gold | Ledger | Cause | Qwen also wrong | Ledger timeline | Gold decisions | Evidence behind the wrong value |
|---|---|---|---|---|---|---|---|---|---|
| ES2004 | q1 | current | kinetic | conventional | wrong value in force | yes | b:rechargeable → c:conventional → c:kinetic → d:conventional | b:rechargeable, c:kinetic | ES2004d: conventional “I think we could change the battery also. Instead of going for kinetic how about” |
| ES2004 | q3 | changes | 1 | 3 | spurious change (extra value written) | yes | b:rechargeable → c:conventional → c:kinetic → d:conventional | b:rechargeable, c:kinetic | ES2004c: conventional “There's um actually no rechargeable option available”; ES2004d: conventional “I think we could change the battery also. Instead of going for kinetic how about” |
| ES2004 | q4 | current | included | None | extraction miss (no value in the ledger) | yes | (empty) | b:included | (the gold decision was not extracted) |
| ES2004 | q11 | past date | None | black and white | decision recorded before it was made | no | a:black and white | d:black and white | ES2004a: black and white “you'd have to sort of keep it down to a black and white L_C_D_ thing anyway, I'd” |
| ES2014 | q8 | changes | 0 | 1 | spurious change (extra value written) | yes | c:excluded → c:included | c:included, d:included | ES2014c: excluded “So you'd have a finder feature rather than a voice recognition feature.” |
| ES2014 | q17 | changes | 1 | 3 | spurious change (extra value written) | yes | c:rubber → d:plastic → d:rubber → d:plastic | c:rubber, d:plastic | ES2014d: rubber “We got rid of the plastic.” |
| ES2014 | q20 | changes | 0 | 1 | spurious change (extra value written) | no | c:double curved → c:single curved | c:single curved, d:single curved | ES2014c: double curved “if you use the uh rubber double curved case then you must use rubber buttons” |
| IS1009 | q9 | current | plastic | rubber | wrong value in force | yes | c:plastic → d:rubber | d:plastic | IS1009d: rubber “Rubber, because we're gonna have the soft buttons.” |
| IS1009 | q11 | changes | 0 | 1 | spurious change (extra value written) | yes | c:plastic → d:rubber | d:plastic | IS1009c: plastic “And I think we all agree on the case, we wanna have something uh maybe bright, c”; IS1009d: rubber “Rubber, because we're gonna have the soft buttons.” |
| IS1009 | q14 | changes | 0 | 1 | spurious change (extra value written) | no | c:hard plastic → d:soft rubber | d:soft rubber | IS1009c: hard plastic “We'll just go for push buttons for in the interest of cost.” |
| TS3003 | q5 | current | multiple devices | televisions only | wrong value in force | yes | b:televisions only | a:multiple devices | TS3003b: televisions only “we've uh got to design a um remote which is only suitable for T_V_” |
| TS3003 | q9 | changes | 0 | 1 | spurious change (extra value written) | no | b:excluded → c:included | b:included, d:included | TS3003b: excluded “I think we'll have to choose between the docking station or the screen, 'cause”; TS3003c: included “On top.” |
| TS3003 | q10 | current | included | excluded | wrong value in force | yes | b:included → d:excluded | b:included, c:included | TS3003d: excluded “Considering we are not going to make a docking station.” |
| TS3003 | q12 | changes | 0 | 1 | spurious change (extra value written) | yes | b:included → d:excluded | b:included, c:included | TS3003d: excluded “Considering we are not going to make a docking station.” |

Inexact routes: 29, all [["as_of_valid", "as_of_tx"]] (a past-date question read as 'what the records said on that date', valid_at = tx_at); the ledger answer is the same in 29 of 29.

## Where DeepSeek full context + CoT is wrong (15 of 96), for comparison

| Team | Q | Type | Gold | Answer | Ledger right | End of its reasoning |
|---|---|---|---|---|---|---|
| ES2004 | q3 | changes | 1 | 0 | no | ecision) - 2026-02-23: battery type remains kinetic (no change) Number of times the decision changed from one value to a different value: 0. ANSWER: 0 |
| ES2004 | q4 | current | included | None | no | ecision to include Video Plus. The closest is discussion of it as an idea/alternative, which does not count. So nothing has been decided. ANSWER: none |
| ES2004 | q7 | current | included | excluded | yes | tic charger" — consistent. So the decision that matters: 2026-02-16 decision for kinetic battery, which excludes the docking station. ANSWER: excluded |
| ES2004 | q8 | past date | None | included | yes | cking station included). - 2026-02-16: Switched to kinetic charging, eliminating the port/docking station (too late to affect Feb 5). ANSWER: included |
| ES2004 | q9 | changes | 0 | 1 | yes |  2026-02-09: docking station included (rechargeable with docking station) - 2026-02-16: docking station excluded (kinetic charging, no port) ANSWER: 1 |
| ES2014 | q4 | past date | None | included | yes | s hidden behind a panel (front page simple, back page detailed) → included. This is the most recent decision in effect on 2026-02-05. ANSWER: included |
| IS1009 | q5 | changes | 0 | 1 | yes | te order: - 2026-02-09: teletext excluded (firm instruction from management) — applies from this date onward. - No later meeting changed it. ANSWER: 1 |
| TS3003 | q5 | current | multiple devices | televisions only | no | ughout. The 2026-02-09 decision (televisions only) is the most recent firm decision in effect, and nothing later reverses it. ANSWER: televisions only |
| TS3003 | q6 | changes | 0 | 1 | yes | ue afterward. Decisions that matter: - 2026-02-09: remote only suitable for TV → televisions only (applies) - (no later decision changes it) ANSWER: 1 |
| TS3003 | q7 | current | included | None | yes | ision. 2026-02-23: Prototype includes an LCD screen, but later cost discussion considers leaving it out; no firm final decision recorded. ANSWER: none |
| TS3003 | q9 | changes | 0 | 1 | no | een kept included (no reversal) — applies, same value. The value changed from one value to a different value exactly once (none → included). ANSWER: 1 |
| TS3003 | q12 | changes | 0 | 1 | no |  of inclusion. So the decision went from none → included (2026-02-09), and never changed to a different value afterward. That is one change. ANSWER: 1 |
| TS3007 | q2 | past date | None | batteries and kinetic | yes | battery only. The most recent decision in effect on 2026-02-05 is the 2026-02-16 one (the 2026-02-23 change came later). ANSWER: batteries and kinetic |
| TS3007 | q5 | past date | None | double curved | yes | single curved due to budget. As of 2026-02-05, only the 2026-02-16 decision existed, so the applicable outcome is double curved. ANSWER: double curved |
| TS3007 | q11 | past date | None | included | yes | o firm decision; touch screen discussed as an option, not decided. - 2026-02-16: Decision made that the buttons will be touch-screen. ANSWER: included |

## Spend

Paid requests 405, failed attempts 0, total $0.1232 by the responses' own cost; last key check: usage $0.1232 of $1, remaining $0.8768.
