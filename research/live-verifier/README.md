# A faster, wider live contradiction check

**Question.** The app's live check wrote a verdict with Qwen3.5-4B (`{"contradiction", "reason", "factId"}`) and then
had the guard (a one-word YES/NO question, scored from the first token) confirm it. In a meeting that took about 4 s per
sentence, so a cue appeared 8–17 s after the words, and a sentence that did not share a word with a decision's name was
never checked. Can the guard's question alone replace the written verdict, and can candidate decisions be found by
meaning as well as by shared words?

**Answer.** Yes to both. On the fixed MemoriaBench test split the shipped check catches 98 of 112 conflicts instead of
91, with 2 false alarms in 224 instead of 3, in 0.26 s instead of 4.0 s (median). On an hour of real, unrelated meeting
speech it raised no alert.

| Live check (test split, 336 probes, 28 series) | Conflicts caught | False alarms | Unverified | Latency p50 / p95 |
|---|---|---|---|---|
| Written verdict, then guard (shipped before, `../memoriabench/results/app_live_check/guard_on.jsonl`) | 91 / 112 (81.3%) | 3 / 224 (1.3%) | 3 | 4.0 / 6.8 s |
| Guard alone, threshold 2.0 | 91 / 112 (81.3%), CI 74.1–87.5 | 2 / 224 (0.9%), CI 0–2.2 | 0 | 0.81 / 1.83 s |
| Guard alone + candidates by meaning (cosine ≥ 0.66) | 100 / 112 (89.3%), CI 83.0–94.6 | 2 / 224 (0.9%), CI 0–2.2 | 0 | 0.56 / 1.70 s |
| **… and 0.08 above the median decision (shipped)** | **98 / 112 (87.5%)**, CI 81.2–92.9 | **2 / 224 (0.9%)**, CI 0–2.2 | **0** | **0.26 / 1.26 s** |

- Paired (exact McNemar), the shipped check against the guard alone: right on 7 probes it got wrong, wrong on none
  (p = 0.016); against the check shipped before: 14 against 6 (p = 0.12). Without the lift, candidates by meaning
  against the guard alone: 10 against 1 (p = 0.012).
- 91 of the 98 caught conflicts cite the reference decision.
- CIs are 95% cluster-bootstrap intervals over the 28 series.
- Research M2, which read the whole ledger with a written verdict, caught 110/112 (`../memoriabench/GUARD.md`).
- **Why the shipped check requires the lift.** A short remark is about as close to every decision. On the AMI hour
  (575 turns of a design meeting that has nothing to do with the procurement pilot, recognised by the app's own
  Parakeet Ultra pipeline, `../long-meeting/results/unrelated-speech-guard-*.jsonl`):
  - Without the lift, 284 turns reached the model; with it, 49. Neither raised an alert.
  - Sentence by sentence, as the meeting window checks it (the hour's 899 live-caption turns,
    `unrelated-speech-live-captions.jsonl`): 74 reached the model, no alert.
  - The lift was chosen on remarks such as "Thanks." and "Thank you all." (no candidate after it) and left the dev
    split unchanged. On test it costs 2 of the 100 catches; 4 alerts differ in all.
  - In a live meeting every question competes with the captions for the GPU, which is why it ships.

## Spoken: the same probes through speech recognition

`spoken.py` speaks each test-split statement with one of six macOS voices in turn (US, British, Australian, Irish,
Indian and South African English; `say`, 16 kHz, never played aloud), recognises it with the app's Parakeet Ultra and
checks the recognised text as above.

| Shipped live check, test split | Conflicts caught | False alarms | Check p50 / p95 |
|---|---|---|---|
| Written statements | 98 / 112 | 2 / 224 | 0.26 / 1.26 s |
| **Spoken and recognised** (WER 2.1%: 67 errors in 3,152 words) | **97 / 112** (86.6%, CI 80.4–92.9) | **2 / 224** | 0.33 / 1.53 s |

- Speech recognition cost one catch: "So the remote will sell for 35 Euro." came out as "… for €35." and was not
  confirmed. No other probe changed.
- Recognition took 0.08 s per statement (p50; 2.9 s of audio).
- WER by voice: Moira 0.6%, Karen 1.2%, Daniel 2.3%, Rishi 2.4%, Samantha 2.6%, Tessa 3.2%. Voices were assigned in
  turn, and the probe order put all 112 conflicts on four of the six voices: Karen 23/28, Moira 22/28, Rishi 27/28,
  Tessa 25/28.
- Synthetic voices are cleaner than people in a room; this measures the recogniser's errors on clear speech, not
  far-field audio or overlap.

## Spoken meetings: audio to cue, through the live pipeline

`spoken_meetings.py` turns each of the 28 test series into one meeting: its 12 statements, in a fixed shuffled order,
one second apart, with the same audio as above. The meeting is captioned by the app's `LiveTranscript` in the meeting
window's 0.256 s blocks, and every committed turn is checked against the series' approved decisions, as the meeting
window does. A statement is alerted when a turn overlapping it raised a cue.
Audio is fed as fast as processing permits; checks block further feeding. The delay below is an estimate: additional
audio before commitment plus the check's wall time. It excludes ASR compute time, queueing, concurrent GPU contention
and UI delivery. Paced installed-worker measurements are in `../live-speech/README.md`.

| Shipped live check, test split | Conflicts caught | False alarms | Estimated statement end → cue, p50 / p95 / max |
|---|---|---|---|
| Spoken meetings, speakers labelled word by word | 93 / 112 (83.0%) | 2 / 224 | 1.34 / 2.24 / 2.59 s |
| **Spoken meetings, one speaker per sentence (shipped)** | **98 / 112** (87.5%, CI 81.2–92.9) | **2 / 224** | **1.26 / 2.19 / 2.66 s** |

- Word by word, the diarizer flickered between similar synthetic voices and split 61 of the 336 statements into
  fragments with alternating speakers ("Right, we | should add an emergency | call | button for | elderly | users."),
  and 5 conflicts were then judged on fragments and missed. One speaker per sentence (the most active over it) leaves
  4 statements in two turns and recovers all 5 (5 against 0, exact McNemar p = 0.062).
- The shipped run gives the same verdict as the written statements on all 336.
- Turns needed 0.68 s of audio after a statement ended to be committed (p50; p95 0.90 s).
- No turn fell outside the statements and no statement went unheard.
- The audio is clean and the voices take turns with one-second gaps; real meetings have overlap, noise and distance.

**In a simulated room** (`--room SNR,RT60,DRR`: a synthetic impulse response and pink noise, seeded per series):

| Shipped pipeline, test split | WER* | Caught (of 112) | False alarms (of 224) | Estimated statement end → cue p50 / p95 | Statements sharing a turn |
|---|---|---|---|---|---|
| Clean | 1.9% | 98 (87.5%) | 2 | 1.26 / 2.19 s | 0 |
| SNR 10 dB, RT60 0.5 s, DRR 3 dB | 4.1% | 93 (83.0%, CI 75.0–90.2) | 6 (CI 0.9–4.9%) | 2.66 / 3.65 s | 22 |
| SNR 5 dB, RT60 0.8 s, DRR 0 dB | 9.6% | 82 (73.2%, CI 64.3–81.2) | 5 | 2.99 / 3.92 s | 18 |
| SNR 0 dB, RT60 0.8 s, DRR −3 dB | 29% | 51 (45.5%, CI 34.8–55.4) | 7 | 3.16 / 3.86 s | 45 |

\* on the statements that kept a turn of their own.

- Misses follow the recogniser's errors ("recharging dock" heard as "… bar").
- Most false alarms are statements that shared a turn with a neighbouring conflict ("The remote will work with several
  devices, so the corporate image will be shown …"); the cue was right for the turn and is counted against both.
- Steady noise defeats the voice detector: at SNR 10 dB WebRTC's detector marks every frame of the gaps as speech
  (mode 2; mode 3 still 30%), so stretches close only at sentence ends or after 10 s. Turns are committed 2.0 s after
  the statement instead of 0.7 s, and statements that the recogniser does not split with a full stop share a turn.
  The diarizer is not fooled (5% of gap frames active at 10 dB, 13% at 0 dB, against all of every statement).

**After the `v0.3.0-uat` build (on `main`), a stretch also ends when the diarizer has heard nobody for 0.5 s** (`streaming_speech.LiveTranscript._speakers_quiet`;
the next stretch starts where the last ended, so no audio is skipped):

| Same runs, with the diarizer pause | WER* | Caught (of 112) | False alarms (of 224) | Estimated statement end → cue p50 / p95 | Audio after statement before commitment, p50 | Sharing a turn |
|---|---|---|---|---|---|---|
| Clean | 1.9% | 98, the same verdicts | 2 | 1.22 / 2.14 s | 0.68 s (unchanged) | 0 |
| SNR 10 dB, RT60 0.5 s, DRR 3 dB | 3.9% | 94 (CI 75.0–91.1) | 4 | 1.91 / 2.87 s | 1.10 s (was 2.00) | 2 (was 22) |
| SNR 0 dB, RT60 0.8 s, DRR −3 dB | 30% | 57 | 3 | 2.32 / 3.81 s | 1.23 s (was 2.18) | 17 (was 45) |

- Paired verdicts against the shipped pipeline (exact McNemar): 5 against 2 at 10 dB (p = 0.45), 21 against 11 at
  0 dB (p = 0.11). The gain is in timing and in keeping statements apart, not yet in significant catches.
- On real speech the change costs a little: live WER on the AMI hour 15.4% instead of 15.2% (insertions 134 against
  111, deletions 943 against 952), 97.6% of words on their participant (97.8%), commit lag p50 / p90 1.04 / 1.99 s
  (1.16 / 2.18 s). The far-field laptop recording is unchanged (recall 0.822).

## Method

`live_assistance.py`, `MEMORIA_LIVE_CHECK=guard` (now the default):

1. The app checks quoted evidence, deterministic numeric proof and past-tense exclusions. It skips the model when
   neither word overlap nor semantic retrieval supplies a candidate.
2. Candidates are the up-to-three slots with the most IDF-weighted word overlap (`live_guard.candidates`, the guard's
   attribution set) plus the lexically selected facts, at most five, each with quoted evidence.
3. **Candidates by meaning** (`live_assistance._semantic`): the sentence is embedded by the app's EmbeddingGemma 2
   worker with its fact-checking prompt (`task: fact checking | query: …`), each current decision as `title: <item> |
   text: <item> <attribute> is <value>` (vectors cached beside the ledger); the two closest decisions with cosine 0.66
   or more join the candidates. This finds sentences that name an item in other words ("We will launch on the 20th":
   0.74 to the go-live date, 0.55–0.60 to the others) and lets them be checked at all. The floor was chosen on the
   dev split (0.60, 0.66 and 0.72 gave the same dev result) and on such paraphrases, before the test split was run.
4. The guard's exact question (`live_guard.question`, wording pinned by research) is scored for each candidate; the
   strongest confirmation at log-odds **2.0** or more is cued. The guard's confirmation threshold is 1.0; asked about up
   to five candidates instead of one cited decision, it needs more confidence. 2.0 was chosen on the **dev split only**
   (60 probes) from the scores of a run at 1.0, before the test split was run once.
5. The Qwen worker keeps the model state after the question's shared opening (rules and worked examples), so each
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
| Guard alone + candidates by meaning (cosine 0.60, 0.66 or 0.72) | 17 / 20 | 2 / 40 | 0 | 0.66 / 1.25 s |

Figures and dates (`_spoken_amount`, `_spoken_date`) are compared without the model in the app; MemoriaBench's
decisions are sentences, so these comparisons never apply to it and the benchmark numbers above are unaffected.

The written verdict sometimes argued with itself after committing to `"contradiction": false` (6,304 characters for
"the pilot budget is now three hundred thousand ringgit", 60 s); the worker now caps a verdict at 320 tokens.

## Limits

After 0.3.1, a singleton-ledger bug was fixed: with only one approved decision, requiring its similarity to exceed the
median by 0.08 meant comparing it with itself, so semantic retrieval could never select it. A sole decision now needs
only the existing 0.66 absolute floor; the model still decides whether it contradicts the statement. Multi-decision
selection is unchanged. Five model-free regression checks cover strong/weak singleton matches, cached vectors and
the existing multi-decision contrast rule (`test_live_semantic.py`). The tables above are the earlier measured runs.

MemoriaBench's source probes are templated English; the spoken variants use synthetic voices. The mapping of AMI
decisions to slots is the harness's (see `../memoriabench/APP_LIVE_CHECK.md`). One machine (M5, 16 GB), one 4B model.
The guard threshold was chosen on dev, but later candidate-selection and speech fixes were evaluated repeatedly on
the test partition. These follow-ups are exploratory comparisons on a reused test set, not untouched confirmation.
Their cue-delay estimates are separate from the paced installed-app and microphone tests.

## Files

- `run.py`: runs the bench with a verifier variant (`baseline`, `reason_first`); the guard-alone runs set
  `MEMORIA_LIVE_CHECK=guard` with `baseline`.
- `results/dev_*.jsonl`, `results/test_guard_first.jsonl`: predictions; `*.summary.json`: harness summaries (the
  `comparison` block in `test_guard_first.summary.json` compared the run with itself and is void; the paired numbers
  above were computed against the shipped predictions directly).
