# Live speech: Parakeet TDT v3 with Nemotron 3 Diarization

**Question.** MOSS-Transcribe-Diarize decoded four-second windows with two seconds of context, so a caption appeared
about five seconds after the words and a contradiction cue 8–17 s after them. Which local models and which way of
running them make captions appear while people speak, without losing accuracy on real meetings?

## Answer

| On the 60-minute AMI hour (ES2004b + start of ES2004c, the report's Table 6.11 fixture) | MOSS (2 Nov) | Parakeet TDT v3, 2-min parts | Parakeet TDT v3, stretches | **Parakeet Ultra, stretches (shipped)** |
|---|---|---|---|---|
| WER, fillers removed | 13.2% | 16.7% | 17.0% | **14.4%** (446 sub., 870 del., 91 ins. over 9,808) |
| WER, fillers kept | 14.7% | 18.3% | 18.5% | **16.3%** |
| Labelled words on their participant | 96.6% | 96.5% | | |
| Words on "Unknown speaker" | 9% | 0 | 25 labels' worth (0.3%) | 6 words |
| Time for the hour | 11 min 34 s | 63 s | 89 s | **113 s** |
| Recogniser memory (MLX, active) | 1.8 GB | 2.55 GB (float32) | 2.55 GB | **1.3 GB** (bfloat16) |

- Speakers: Nemotron 3 Diarization (offline preset for whole recordings, 0.64 s preset live) gives every word a
  label; MOSS left 9% on "Unknown speaker".
- **Parakeet Ultra** ([moondream/parakeet-ultra](https://huggingface.co/moondream/parakeet-ultra), CC BY 4.0) is a
  post-training of v3 with the same architecture and tokenizer, so it drops into the same code. It cuts v3's
  deletions from 1,074 to 870 and needs half the memory in its bfloat16 MLX build.
- Remaining gap to MOSS (14.4% against 13.2%): mostly back-channels and overlapped speech, which a single-speaker
  recogniser drops.
- **Stretches instead of two-minute parts.** On a recording the app made through the laptop microphone (the test
  meeting played through the speakers, 207 s, quiet: mean −49 dBFS), reading two-minute parts lost whole sentences:
  v3 found 68% of the reference words in order, 82% when read stretch by stretch (Ultra: 82% either way). On the
  close-talk AMI hour the two ways are equal (16.7% against 17.0%), so the app reads stretches everywhere.
- Gain normalisation before decoding changed recall by one point (0.683 → 0.693), so it is not used.
- One phrase stayed wrong through the microphone with every model and setting: "Gamma Solutions is our vendor now"
  (a synthetic voice) came out as "… is all wind and oil", "… is of internet now". Live checks that depend on
  hearing the item's name miss such sentences.

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
