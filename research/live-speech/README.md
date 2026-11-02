# Live speech: Parakeet TDT v3 with Nemotron 3 Diarization

**Question.** MOSS-Transcribe-Diarize decoded four-second windows with two seconds of context, so a caption appeared
about five seconds after the words and a contradiction cue 8–17 s after them. Which local models and which way of
running them make captions appear while people speak, without losing accuracy on real meetings?

## Answer so far

| On the 60-minute AMI hour (ES2004b + start of ES2004c, the report's Table 6.11 fixture) | MOSS (2 Nov) | Parakeet TDT v3 + Nemotron 3 Diarization, whole recording |
|---|---|---|
| WER, fillers removed | 13.2% | 16.7% (454 substitutions, 1,104 deletions, 80 insertions over 9,808 words) |
| WER, fillers kept | 14.7% | 18.3% |
| Labelled words on their participant | 96.6% | 96.5% (8,704 words) |
| Words on "Unknown speaker" | 9% | 0 |
| Time for the hour | 11 min 34 s | 63 s (load 6.5 s) |
| Speech-model memory (MLX) | 1.8 GB active | 2.75 GB active (Parakeet 2.55, diarizer 0.2), 3.4 GB peak over the hour |

- Parakeet loses more words than MOSS: 1,104 deletions against 554. The deleted words are mostly back-channels
  ("yeah" 76, "okay" 32, "right" 17) and 42 runs of five or more words, where one person talks over another. Single
  speaker ASR keeps the dominant voice; MOSS, a speech language model, transcribes more of the overlap.
- Speakers come out as well as MOSS's, with no unknown speaker, and the hour takes a minute instead of twelve.

Live captions (`streaming_speech.LiveTranscript`):

- The open stretch of speech is re-read every half second (every second once it is longer than 5 s) for the words
  being spoken. A stretch closes when the speaker pauses for half a second, after a finished sentence that speech has
  moved 0.8 s past (cut at the quietest moment before the next word), or at its quietest moment after 10 s. A closed
  stretch is read once more and its sentences become turns as soon as the diarizer (0.64 s preset) has caught up.
- Stretches never overlap, so no word is committed twice; silence is never decoded.
- On the scripted test meeting (`livetest/meeting.wav`, file fed as fast as possible): every sentence was committed
  0.5–1.3 s after it ended, all three voices on the right label; worst single feed 0.52 s.

Rejected on the way:

- **Re-decoding a rolling window with left context** (first design): word times move by a frame or two between
  decodings, and words near the boundary were committed twice ("there," and "there.", "care." and "pair.").
- **Nemotron Speech Streaming EN 0.6B** (cache-aware, 560 ms): on the scripted meeting it ran the sentences of three
  speakers into one, dropped "Gamma" from "Gamma Solutions" and wrote numbers as words; in float32 it needs 2.5 GB.
  Kept as `MEMORIA_LIVE_ASR=stream`.
- **bfloat16 weights**: decoding was slower (10 s of speech: 0.149 s against 0.095 s in float32) and active memory did
  not drop, so the models run as published.
- **Growing the diarizer's history by concatenation**: copying it on every quarter second made an hour quadratic; it
  now grows by doubling.

## Files

- `bakeoff.py`: runs a pipeline over the hour and scores it with `../long-meeting/evaluate_transcript.py`.
- `results/ami-hour-offline.*`: the whole-recording run above.
