# Live speech: Parakeet TDT v3 with Nemotron 3 Diarization

**Question.** MOSS-Transcribe-Diarize decoded four-second windows with two seconds of context, so a caption appeared
about five seconds after the words and a contradiction cue 8–17 s after them. Which local models and which way of
running them make captions appear while people speak, without losing accuracy on real meetings?

## Answer

| On the 60-minute AMI hour (ES2004b + start of ES2004c, the report's Table 6.11 fixture) | MOSS (2 Nov) | Parakeet TDT v3, 2-min parts | Parakeet TDT v3, stretches | **Parakeet Ultra, stretches (shipped)** |
|---|---|---|---|---|
| WER, fillers removed | 13.2% | 16.7% | 17.0% | **14.4%** (446 sub., 870 del., 91 ins. over 9,808) |
| WER, fillers kept | 14.7% | 18.3% | 18.5% | **16.3%** |
| Labelled words on their participant | 96.6% | 96.5% (8,704 words) | 97.0% (8,714) | **97.4%** (8,934; 96.8% labelled word by word) |
| Words on "Unknown speaker" | 9% | 0 | 20 | **4** |
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
- One voice detector listens to the whole meeting. WebRTC's detector adapts to the room as it listens; the first
  version made a new one for every 0.256 s block it was given, and on 55 s of the AMI hour it heard 512 of the 1,302
  voiced frames that one detector hears. Whole phrases were never decoded.

The AMI hour fed to live captions in the meeting window's 0.256 s blocks (`bakeoff.py live`; the lag is how much
audio had arrived after a sentence ended when it was committed, so it does not depend on how fast the run went):

| | A new detector per block (before) | One detector per meeting | **… and one speaker per sentence (shipped)** | Whole recording, for reference |
|---|---|---|---|---|
| WER, fillers removed | 18.9% (502 sub., 1,257 del., 96 ins.) | 15.2% (430, 952, 111) | **15.2%** | 14.4% (446, 870, 91) |
| Labelled words on their participant | 96.7% | 96.9% | **97.8%** | 97.4% |
| Turns | 1,265 | 1,119 | **899** | 333 (merged within 1.5 s) |
| Commit lag p50 / p90 / max | 0.92 / 2.77 / 10.8 s | 1.34 / 3.87 / 9.9 s | **1.16 / 2.18 / 6.5 s** | |
| One re-read of the open stretch, p50 / p95 | 0.093 / 0.196 s | 0.092 / 0.177 s | 0.091 / 0.177 s | |

- One speaker per sentence: labelled word by word, the diarizer's flicker split sentences into fragments with
  alternating speakers. Each sentence now takes the speaker most active over it (`streaming_speech.turns_of`). The
  lag is measured per turn, so fragments that waited for the rest of their sentence no longer count as late turns.
- Longer stretches still cost commit lag: a sentence inside continuous speech is committed once speech is 0.8 s past
  it, at the next re-read.
- On the two scripted test meetings (`livetest/meeting.wav`, `meeting2.wav`, file fed as fast as possible) every
  sentence was committed 0.4–2.1 s after it ended (median 0.75 s).
- One sentence of `meeting.wav` ("Data migration is almost done.", the macOS voice Aman) is recognised as nonsense
  by v3 and Ultra alike, whole or live, so that voice's recording is at fault, not the cutting.

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
- `results/ami-hour-live.*` (shipped), `results/ami-hour-live-word-labels.*`, `results/ami-hour-live-fresh-vad.*`: live
  captions over the hour, as shipped, before one speaker per sentence, and before the detector fix.
- `results/ami-hour-ultra-sentences.*`: the whole-recording run with one speaker per sentence (shipped).
