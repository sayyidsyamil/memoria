# M2 meeting intelligence check

Verified on 2 November 2026 in the installed app (`~/Applications/Memoria Workspace.app`, debug
build of the M2 commits) with disposable vaults. Speech came from the AMI Meeting Corpus
(CC BY 4.0) and from the fictional M1 fixtures; no participant data was used. This is not UAT.

## What changed in M2

| Item | Change | Tests |
|---|---|---|
| Live check guard | The evaluated MemoriaBench guard (`research/memoriabench/guard.py`) confirms each semantic alert with one YES/NO question to the same Qwen model (first-token log-odds ≥ 1.0), re-citing the best of the three lexically closest current facts or dropping the alert. Exact numeric proofs stay deterministic. A `score` request on the resident Qwen worker returns first-token log-probabilities. | `test_live_guard.py`, `test_qwen_scoring.py`, `test_live_assistance.py` |
| Long meetings | Recordings up to three hours are transcribed in overlapping five-minute parts (midpoint ownership, audio-clock offsets, voices matched across parts, failed parts retried once in halves and otherwise reported as gaps). Worker deadlines for transcription, knowledge review and tracked-fact ingest follow reported progress instead of a five-minute total. Knowledge review packs short turns into one call up to 3,000 characters. Tracked-fact extraction reads long meetings through the evaluated `WindowedExtractor`. The meeting record cap is 8 MB. | `test_transcribe.py`, `test_engine.py`, `test_temporal_service.py`, `test_meetings_service.py`, `wiki_memory.rs` |
| Crash-safe meeting save | A write-ahead intent in SQLite makes a save or delete killed between the Markdown page and the record recoverable on the next read; outside edits stay protected. | `test_meetings_service.py` (including a real SIGKILL) |
| Ask from tracked facts | Current-value, value-on-a-date and change questions are answered from approved tracked facts with fixed sentences (no model), citing the quoted evidence and meeting moment. | `test_ask_facts.py`, `MemoryAsk.test.tsx` |
| Tracked items setup | Only the kinds the ledger accepts are offered; label and kind of an existing item are fixed with an explanation; type or allowed-value edits that would strand recorded values are held back. Headings show the item label. | `TemporalMemoryPanel.test.tsx`, `trackedItemRules.test.ts` |
| Speaker picker | Offers People notes and names used in other meetings. | `MeetingTranscriptReview.test.tsx`, `knownSpeakerNames.test.ts` |

## Ask from tracked facts (M1 vault)

The M1 vault holds two fictional meetings: run 1 chose Acme as supplier, run 2 changed it to Beta.

| Question | Answer in the app |
|---|---|
| Which supplier do we use now? | "From tracked facts · Pilot — supplier · current value" — "The current supplier for Pilot is Beta (decided 2 Nov 2026, 13:42)." Evidence R1: meeting 2's reviewed transcript |
| What changed about the supplier? | "The supplier for Pilot changed once: Acme → Beta." with R1 (meeting 1) and R2 (meeting 2); then "Acme — decided 2 Nov 2026, 13:15." and "Beta — decided 2 Nov 2026, 13:42.", each with its evidence |

In M1 the first question returned "The reviewed knowledge does not answer this", and the second
cited only meeting 2.

## Live check on MemoriaBench (app's resident Qwen worker)

`research/memoriabench/app_live_check_bench.py` runs the frozen test probes through the
app's own `live_check` on disposable approved ledgers, using the installed app's resident
Qwen socket for the verifier and the guard. Each benchmark decision becomes one tracked
item (label: the sentence's first content word; attribute and value: the sentence). Full
method, threats to validity and failure cases: `research/memoriabench/APP_LIVE_CHECK.md`.

Test split: 336 probes (112 conflicts, 224 must-not-alert), 28 series, 95% cluster-bootstrap
intervals by series.

| App live check | Conflicts caught | False alarms | Alert precision | Latency p50 / p95 |
|---|---|---|---|---|
| **Guard on (shipped on 2 November)** | **81.3%** (75.0–87.5) | **1.3%** (0–3.1) | 96.8% | 4.0 / 6.8 s |
| Guard on, item must be named | 58.0% (50.0–66.1) | 0.9% (0–2.2) | 97.0% | 3.4 / 5.9 s |
| Guard off, item must be named | 56.3% (47.3–65.2) | 2.7% (0.9–4.9) | 91.3% | 3.7 / 5.7 s |
| Research M2 auditor (reference) | 98.2% | 0.4% | | |

On 3 November this check was replaced by the guard's question alone, with candidates also found
by meaning: 87.5% (98 of 112) caught, 0.9% (2 of 224) false alarms, 0.26 s median
([research/live-verifier](../../research/live-verifier/README.md)).

The first full run used the gate inherited from M1: a conflict was suppressed unless the
sentence named the tracked item. 40 of its 47 misses failed only on that gate, which
people rarely satisfy ("We'll use Globex as supplier" never says "Pilot"). The evaluated
research design has no such gate: the guard's question already asks whether the sentence is
about the very thing a decision settles. With the guard on, the gate was removed (better on
26 probes, worse on 1, exact McNemar p = 4.2e-7); with `MEMORIA_GUARD=off` it remains. The
guard itself removed 4 of the 6 false alarms the app's verifier raised.

Remaining gap to the research auditor: recall −17.0 points (−24.1 to −10.7). Most of the 21
misses never reached the guard: the five-fact lexical selection left out the decision (many
items share "remote") or the app's verifier judged no conflict. The 3 false alarms are model
errors on paraphrases of the current decision and one wrong attribution. On real, unrelated
speech (all 852 turns of the hour below, checked against the UAT procurement facts) the app
raised no alert; 29 turns reached the model ([research/long-meeting](../../research/long-meeting/README.md)).

## A 60-minute recording, end to end

Speech in this check was MOSS-Transcribe-Diarize. Since 3 November the app uses Parakeet Ultra
with Nemotron 3 Diarization: on the same hour, WER 14.4% (fillers removed), 97.4% of labelled
words on the right participant, 113 s ([research/live-speech](../../research/live-speech/README.md)).

Fixture (`m2-long`, scratch): AMI ES2004b (39:05) followed by the first 20:55 of ES2004c, one
mono recording of exactly 60:00, encoded as WebM/Opus 48 kb/s like the app's own recordings
(16.9 MB). Four participants; the reference is the AMI manual word annotation of the same span
(10,179 words). The meeting was seeded through the app's meeting API into a fresh vault with
the ES2004 tracked items from `research/ledger-engine/data/ami_v0/ES2004.chain`, then driven
in the app: Meetings → Review transcript → Create transcript. Scoring script:
`evaluate_transcript.py` (research normalisation, word-level alignment, ±15 s windows at each
part boundary against mid-part control windows).

### Run 1 (first chunked build)

| Measure | Result |
|---|---|
| Wall time, click to draft | 12 min 12 s (713 s of model processing): about 4.9× real time |
| Parts | 13 of 13 complete, no retries, no gaps |
| Coverage | first turn at 0:00.2, last ending at 59:58.7; every 5-minute span holds 95–99% of its reference words |
| WER (fillers removed / kept) | **13.4%** / 14.9% (S 519, D 553, I 241 of 9,808 words) |
| Boundary windows vs mid-part | 17.2% vs 10.3% local error |
| Speakers | 3 labels plus unassigned; one label held two participants (1,819 and 1,793 words) |

Two faults followed from how the parts were joined, and both were fixed (commit "keep speakers
apart and passages once"):

- **Merged people.** Each part's speakers were matched to the recording's voices one at a time,
  so two different people in one part could both take the closest voice. Transcribing part 4
  alone showed MOSS itself separates all four speakers there (purity above 95%). A part's
  speakers now never share a voice.
- **Boundary duplicates and losses.** Where the two parts segmented the overlap differently,
  midpoint ownership kept a passage twice (2 of 12 boundaries, 10 repeated words each) or
  dropped it ("our market was going to be young business kind of range" at 42:10). The
  boundary now moves to a pause both parts agree on, and a repeated opening is trimmed when
  speech runs through the overlap.

### Model loading under memory pressure (found between runs)

After the restart for run 2, the speech and embedding models failed all three 60-second
preparation attempts: Teams, Edge, Chrome and other apps held most of the 16 GB (11.7 GB of
swap in use), so transcription was unavailable until the next restart. The same speech worker
started by hand was ready in under 100 s. Preparation now allows 300 s per attempt, and the
failure message names memory-heavy apps. UAT guidance should still ask participants to close
memory-heavy apps; a lower-memory mode is a candidate for M7.

### Run 2 (fixed joining), and the same parts joined both ways

Run 2 ran the installed app's speech worker on the same recording through the app's
`transcribe.py` request (the button path was verified in run 1; the Mac was in use, so the UI
was not driven).

| Measure | Run 1 | Run 2 |
|---|---|---|
| Model processing / wall time | 713 s / 12 min 12 s | 690 s / 11 min 34 s |
| Turns, coverage, gaps | 852; 0:00–59:59; none | 852; 0:00–59:59; none |
| WER, fillers removed | 13.4% | **13.2%** |
| Boundary windows (control 10.3%) | 17.2% | 15.1% |
| Repeated passages at boundaries | 2 | 0 |
| Speaker labels | 3 (one holding two people) + unassigned | **4, one per participant (purity 95–99%)** + unassigned |
| Words on "Unknown speaker" | 3% | 9% |

MOSS output is not bit-identical between runs, so the 13 parts were also decoded once on
their own (each through the same worker) and joined offline both ways:

| Joining | WER | Labelled words with the right person | Unassigned words |
|---|---|---|---|
| First build: independent matching, midpoint ownership | 13.7% | 72.3% | 6.1% |
| Shipped: one voice per part speaker, shared-pause cut, repeat trim | 13.4% | **96.6%** | 6.1% |
| Shipped plus elimination among untaken voices | 13.4% | 96.6% | 6.1% |

Elimination changed nothing here and was not shipped. The remaining "lost passage" near 42:10
was not a joining fault: part 9 decoded alone contains it, but in the full run that part's
decoding ended the turn early: run-to-run decoding variation that ownership cannot recover.

### Knowledge and tracked facts from the hour

The run 2 draft was saved as a reviewed transcript exactly as the review screen saves it (same
text, source page and meeting record; speakers left as "Speaker 1–4" and "Unknown speaker"),
then built through the app's `engine.py` requests with the app's resident Qwen and embedding
workers. The meeting record with its turns and draft is 288 KB.

| Build | Time | Groups | Suggestions | Skipped groups | Evidence by 10 minutes (0–60) |
|---|---|---|---|---|---|
| First | 90 s | stopped at 3 of 24 | — | the whole review failed on one invalid group | — |
| After "skip and name an unreadable group" | 11 min | 24 | 49 | **7 of 24** (one bad quote rejected its whole group) | 6, 11, 3, 10, 2, 17 |
| After "keep valid claims, re-cite exact quotes" | **6 min 10 s** | 24 | **77** (22 decisions) | **0**; 7 suggestions left out for inexact quotes | 10, 15, 10, 15, 10, 17 |

Every ten minutes of the meeting now contributes suggestions, up to 59:43; nothing is dropped
without being counted in the review.

Tracked facts (ES2004 items: battery type, Video Plus, docking station, LCD colours, speech
recognition): 99 s, ten windowed model calls over the whole transcript, three proposals with
quoted evidence: battery **rechargeable** and docking station **included** (32:07, "Rechargeable
with a docking station."), speech recognition **excluded** (41:30, "We have decided on a- leaving
out the voice recognition."). These match the AMI decisions for this span (the battery later
becomes kinetic in ES2004d, outside the hour). Video Plus inclusion was not proposed.

### Notes

- After run 1 the Mac was in use, so run 2, the reviewed save and both builds used the app's own
  requests and workers rather than the UI. The UI path was verified for transcription in run 1
  and for Ask; the knowledge review screen's "skipped parts" notice is covered by a component
  test only.
- While driving the UI, the workspace window intermittently disappeared from the accessibility
  tree until the app was activated again (another app was in front, possibly on another
  Space); not reproduced deliberately.
- Live captions in a new meeting wait while a long recording is being transcribed: both use
  the one resident speech worker. Recording itself is unaffected (M3).
