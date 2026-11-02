# The guard: what an alert must survive before it is shown

(The last section is the same method applied to "Find decisions".)

`guard.py` sits between the auditor (`memoria.check_statement`) and the card. The auditor itself is unchanged and the benchmark
(`run_benchmarks.py`, `results/`) still measures it alone.

## Why it exists

Tested on real speech instead of on the benchmark's templated sentences, the auditor raised a false alert on **15.7%** of sentences
(97 of 616; 95% CI 13.1 to 18.8%): about 87 an hour of continuous speech. All 97 were `OUTDATED`, citing a decision that had
nothing to do with what was said. Its prompt only defines `IRRELEVANT` as chatter about food or weather, so every other sentence
(a phone review, a lecture) was judged as a claim about the project; and it read the whole ledger and wrote a reason in one pass,
which a 4B model does badly. The benchmark could not show this: its `IRRELEVANT` probes are banter.

## What it does

1. **Relevance.** A sentence that shares no meaningful word (stemmed; figures, money words and quarters normalised) with any decision is
   not audited. Answer `IRRELEVANT`, in about a millisecond. Most real speech stops here, so the model is idle for most of a meeting.
2. **Confirmation.** When the auditor alerts, the same model is asked one narrow question about the decision it cited: *does this
   sentence clash with this decision? YES or NO.* Score = log-odds of YES over NO from the first token; the alert stays only at
   `MIN_SCORE = 1.0` or more.
3. **Attribution.** If the cited decision does not confirm (or does not exist), the up to three decisions that share the most words
   with the sentence are asked the same question; the best one that confirms is cited instead (and fixes the card when the auditor
   named the wrong decision). Otherwise the alert is dropped (`INSUFFICIENT_EVIDENCE`).

So an alert that is shown always names a decision that exists and was checked against that sentence. Non-alerts pass untouched.
`MEMORIA_GUARD=off` turns the guard off. The HUD logs `guard what=dropped|moved` (never the sentence).

## Results

False alerts on real speech (YouTube captions: interviews, lectures, lifestyle, product design, tech reviews, business, meetings;
54 videos, about 27 hours; sentences drawn at random). Every alert is false, because the ledgers are about something else.

| ledger | sentences | auditor alone | with the guard |
|---|---|---|---|
| the real one (5 decisions) | 616 alone, 2,430 guarded | 15.7% (13.1 to 18.8) | **0.21%** (0.09 to 0.48), about 1 an hour |
| the same 616 sentences, paired | 616 | 97 alerts | 1 alert |
| 8-decision business ledger | 288 | 9.7% (6.8 to 13.7) | 0 (upper bound 1.3%) |
| 18-decision ledger of a real design meeting | 300 | 6.0% (3.8 to 9.3) | 0 (upper bound 1.3%) |
| 101-decision ledger | 150 | 14.7% (9.9 to 21.2) | 0 (upper bound 2.5%) |

MemoriaBench test (112 conflicts, 224 sentences that must not alert), the same probes and ledgers as M2:

| | conflicts caught | with the right decision | false alarms |
|---|---|---|---|
| auditor alone (M2) | 110 / 112 (98.2%) | 101 (90.2%) | 1 / 224 |
| with the guard | 107 / 112 (95.5%) | 102 (91.1%) | 1 / 224 |

The guard costs 3 conflicts of 112 (2.7 points) and gains one correct citation. On the held-out half of the hand-written look-alikes
(same words, other subject; 23 sentences that must not alert), 3 still alert (a watch's titanium case against "Case material is
rubberized plastic").

Speed (this Mac): a sentence about no decision, about 0 ms; a relevant sentence with no alert, 1.0 s (5 decisions) to 1.7 s (18); a
confirmed alert about 2.1 s; a dropped one 2.3 s (p95 3.4 s). With 101 decisions the auditor itself takes 5.6 s a sentence (p95 6.4 s),
the guard adds up to 2.6 s to a dropped alert, and 57% of sentences still cost nothing.

## What it cannot do

* A real conflict that uses no word of the decision is not audited (none of the 112 on the benchmark, 1 of 12 hand-written paraphrases).
* A look-alike in the *same field* still gets through: the 5 alerts left in 2,430 sentences were about batteries, prices, materials
  and a launch date, said in videos about other products. From one sentence, nobody can tell. A decision that names its subject
  ("The remote's case is rubberized plastic") helps; one that does not ("Price cap: twenty-five dollars over") invites them.
* What the auditor misses, the guard cannot add (2 of 112 on the benchmark; "unit cost will come to fourteen euros" in a hand test).
* English; one 4B model; the thresholds and wording were chosen on development data, but `MIN_SCORE` was picked after seeing both
  halves from three values fixed in advance (0, 1, 2), so the test numbers are slightly optimistic.

## Tests

`python3.11 test_guard.py` (39 checks, no model) and `python3.11 test_guard_live.py` (27 checks, real model). The wording of the
question is pinned by a hash in `test_guard.py`: change it and the measurements above no longer hold.

## The same check for "Find decisions"

`extract.py` reads a meeting that has ended and proposes decisions and commitments. It was made for documents, and on speech it proposes
too much. Measured on real conversation with no decision-making in it (18 YouTube videos, 29,486 words) it proposed 221 items, 7.5 per
1,000 words (about 13 per 12 minutes), and in 15 AMI design meetings (69,813 words) 8.9 per 1,000 words: the number of proposals says
nothing about whether anything was decided. Two samples of 180 proposals each, labelled by me blind to the scores (definitions below),
found that in the design meetings only 19 to 24% were a decision or a task, and 44 to 52% if a proposal that is still open counts; in
the videos 0 to 8%. Writing the reader a better prompt for speech did not help (it proposed more, 80 against 55 on one meeting, and
still proposed questions), and the reader is unstable: one meeting gave 96 proposals with its speakers named by role and 55 with them
named A to D.

So each proposal from a meeting is now checked once more, alone, with the two lines said before it: *does the last line state a
concrete choice, requirement or task for the speakers' own project or plans, something they decide, agree on, propose to do,
require or promise? YES or NO.* The score is log-odds as above; below `MIN_CONFIRM = -4.0` the proposal is dropped. This is in
`find_in_meeting(..., confirm=...)`; the HUD passes `extract.model_confirm`. Documents are read as before.

Labels: D decided, agreed or required; C promised or assigned (an action item, not what a speaker is about to do this minute);
P proposed for their own plans but not settled; N anything else (opinion, question, description, story, advice, boilerplate, filler,
fragment). The threshold was chosen on the first 180 (a different set of meetings and videos) and used unchanged on the second 180.

| 180 labelled proposals | development | test (threshold fixed before) |
|---|---|---|
| decisions, tasks and proposals kept | 48 / 50 (96%) | 51 / 52 (98%) |
| everything else removed | 58 / 130 (45%) | 67 / 128 (52%) |
| area under the curve, D/C/P against N | 0.82 | 0.90 |
| design meetings: proposals kept, share that is D/C/P | 82%, 44% to 51% | 87%, 52% to 59% |
| real talk: proposals kept | 38 / 80 | 25 / 80 |

It is a modest filter, not a cure: in a real design meeting it takes away about one proposal in six and keeps nearly every decision; on
talk that is not a decision-making meeting it takes away about half to two thirds. About 0.5 s a proposal: 78 s in all for a 4,100-word
meeting, reading included. Caveats: the labels are mine and the samples small (52 positives on test); the AMI annotators' links
from decisions to utterances could not serve as ground truth (random sentences hit 66% of their windows, the reader's proposals 70%).
