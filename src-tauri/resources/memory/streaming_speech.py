"""Live and whole-recording speech: Parakeet Ultra words, Nemotron 3 Diarization speakers.

Parakeet decodes a few seconds of audio in well under a tenth of a second, so live captions re-decode the
still-open stretch of speech every half second: the words of a sentence appear while it is spoken and the
sentence is committed, as an immutable turn, once speech has moved past it. Each word takes the speaker the
diarizer finds most active over its span. Nothing is decoded over silence, so nothing is invented there.
"""
import math
import time

import numpy as np

RATE = 16000
# Parakeet Ultra (Moondream's post-training of NVIDIA Parakeet TDT 0.6B v3, same architecture and tokenizer), MLX
# bfloat16 build. On the 60-minute AMI hour it errs on 14.4% of words against 17.0% for v3, in half the memory.
ASR_MODEL = 'selcukkubur/parakeet-ultra-mlx'
ASR_REVISION = 'b554592c50b2a48471add2daa3d46fa9f00fef5e'
DIAR_MODEL = 'mlx-community/Nemotron-3-Diarization'
DIAR_REVISION = '59ed2dbfc1346dcea9d423c71306a3a2499c568f'
MODEL_LABEL = 'Parakeet Ultra 0.6B + Nemotron 3 Diarization'
STREAM_MODEL = 'nvidia/nemotron-speech-streaming-en-0.6b'
STREAM_REVISION = 'ebe59e5a817142986528bbbee5dba8db7b38ed50'
STREAM_LABEL = 'Nemotron Speech Streaming EN 0.6B (560 ms) + Nemotron 3 Diarization'
FRAME_SECONDS = .08      # one Nemotron/Parakeet encoder frame: 8 x 10 ms

FRAMES_PER_SECOND = 100  # Nemotron 3 Diarization speaker probabilities, one row per 10 ms
ACTIVE = .3              # a speaker's mean probability over a word that makes it the word's speaker
SENTENCE_END = ('.', '?', '!')


def recogniser():
    """'parakeet' (default: Parakeet Ultra over stretches of speech cut at pauses) or 'stream' (Nemotron Speech
    Streaming EN, cache-aware). On the scripted test meeting the streaming model ran sentences of three speakers
    together, dropped "Gamma" from "Gamma Solutions" at 560 ms and wrote numbers as words, so it is not the default."""
    import os
    return 'stream' if os.environ.get('MEMORIA_LIVE_ASR', '').strip().lower() == 'stream' else 'parakeet'


def label(models):
    return STREAM_LABEL if streaming(models) else MODEL_LABEL


def streaming(models):
    return hasattr(models[0], 'create_streaming_session')


def revision(models):
    return f"{STREAM_REVISION if streaming(models) else ASR_REVISION}+{DIAR_REVISION}"


def load(kind=None):
    """(recogniser, diarizer) for the configured live recogniser."""
    if (kind or recogniser()) == 'stream':
        _, diar = load_models(recogniser=False)
        return load_streaming_model(), diar
    return load_models()


def load_models(recogniser=True):
    """Parakeet Ultra and the diarizer from the local cache."""
    from mlx_audio.stt import load
    from mlx_audio.vad import load as load_diarizer
    # Repository names, not snapshot paths: the loaders tell model families apart by name. The pinned revisions
    # resolve from the local cache (HF_HUB_OFFLINE is set by every worker).
    asr = load(ASR_MODEL, revision=ASR_REVISION) if recogniser else None
    diar = load_diarizer(DIAR_MODEL, revision=DIAR_REVISION, strict=True)
    return asr, diar


def warm(models):
    """Compile kernels before readiness is reported; the output is discarded."""
    import mlx.core as mx
    asr, diar = models
    silence = np.zeros(RATE, dtype='float32')
    if streaming(models):
        session = timed_session(asr)
        session.feed(silence)
        session.close()
        while not session.done:
            session.step()
    else:
        asr.decode_chunk(mx.array(silence))
    diar.generate(mx.array(silence))


def words_of(result, offset=0.0):
    """[start, end, text, ends_sentence] per word of a Parakeet result; a token opening with a space opens a word."""
    words, spaced = [], True
    for sentence in result.sentences:
        for token in sentence.tokens:
            text = token.text
            if not text.strip():
                spaced = True  # a word boundary on its own, as before a number
                continue
            end = token.start + token.duration + offset
            if spaced or text.startswith(' ') or not words:
                words.append([token.start + offset, end, text.strip(), False])
            else:
                words[-1][1] = max(words[-1][1], end)
                words[-1][2] += text
            spaced = False
        if words:
            words[-1][3] = True
            spaced = True
    for word in words:
        word[3] = word[3] or word[2].endswith(SENTENCE_END)
    return words


class SpeakerTrack:
    """Speaker activity on the session clock, fed as audio arrives (streaming) or all at once (offline)."""

    def __init__(self, diar, preset='very_low'):
        diar.set_streaming_config(preset)
        self.diar, self.state = diar, diar.init_streaming_state()
        # Grown by doubling: copying the whole history on every 0.25 s of audio made an hour quadratic.
        self._rows = np.zeros((6000, diar.config.num_speakers), dtype='float32')
        self.frames = 0

    @property
    def probs(self):
        return self._rows[:self.frames]

    @probs.setter
    def probs(self, rows):
        self._rows, self.frames = np.asarray(rows, dtype='float32'), len(rows)

    def feed(self, samples, final=False):
        output, self.state = self.diar.feed(samples, self.state, final=final)
        rows = np.array(output.speaker_probs, dtype='float32')
        if len(rows):
            if self.frames + len(rows) > len(self._rows):
                grown = np.zeros((max(2 * len(self._rows), self.frames + len(rows)), self._rows.shape[1]), dtype='float32')
                grown[:self.frames] = self._rows[:self.frames]
                self._rows = grown
            self._rows[self.frames:self.frames + len(rows)] = rows
            self.frames += len(rows)

    @property
    def known_until(self):
        return self.frames / FRAMES_PER_SECOND

    def label(self, start, end):
        """'S01'... for the speaker most active over [start, end]; 'unassigned' when no one clearly is."""
        first = max(0, int(start * FRAMES_PER_SECOND))
        last = max(first + 1, int(math.ceil(end * FRAMES_PER_SECOND)))
        window = self.probs[first:last]
        if not len(window):
            return 'unassigned'
        mean = window.mean(axis=0)
        best = int(mean.argmax())
        if mean[best] < ACTIVE:
            # A short word between turns: the nearest clearly active frame decides, within half a second.
            around = self.probs[max(0, first - 50):last + 50]
            if not len(around) or around.max() < ACTIVE:
                return 'unassigned'
            best = int(np.unravel_index(around.argmax(), around.shape)[1])
        return f'S{best + 1:02d}'


def turns_of(words, label, merge_gap=None):
    """Turns from attributed words: a new turn at each speaker change and, live, at each sentence end.

    merge_gap=None keeps one sentence per turn (live captions, so each statement is checked on its own);
    a number joins a speaker's consecutive sentences unless they are that many seconds apart (review)."""
    turns = []
    for start, end, text, ends in words:
        speaker = label(start, end)
        last = turns[-1] if turns else None
        joins = last is not None and last['speaker'] == speaker and (
            not last['closed'] or (merge_gap is not None and start - last['end'] <= merge_gap))
        if joins:
            last['text'] += ' ' + text
            last['end'] = round(end, 2)
        else:
            turns.append({'start': round(start, 2), 'end': round(end, 2), 'speaker': speaker, 'text': text, 'closed': False})
        turns[-1]['closed'] = ends
    for turn in turns:
        del turn['closed']
    return turns


VAD_FRAME = 480  # 30 ms at 16 kHz


def voiced_frames(samples):
    """One flag per whole 30 ms frame: WebRTC VAD (mode 2) above a small loudness floor, as live_speech.has_speech."""
    import webrtcvad
    vad = webrtcvad.Vad(2)
    count = len(samples) // VAD_FRAME
    frames = np.asarray(samples[:count * VAD_FRAME], dtype='float32').reshape(count, VAD_FRAME)
    loud = np.sqrt((frames ** 2).mean(axis=1)) >= .0005
    pcm = (np.clip(frames, -1, 1) * 32767).astype('<i2')
    return np.array([bool(loud[i]) and vad.is_speech(pcm[i].tobytes(), RATE) for i in range(count)], dtype=bool)


class LiveTranscript:
    """Captions for one meeting from Parakeet, over stretches of speech cut where the speaker pauses.

    While someone speaks, the open stretch (at most ten seconds) is decoded again every half second for the words
    being spoken. When they pause for half a second, or the stretch reaches ten seconds and is cut at its quietest
    moment, the stretch is decoded once more and its sentences are committed as immutable turns as soon as the
    diarizer has caught up with them. Stretches never overlap, so no word is committed twice, and silence is never
    decoded, so nothing is invented there."""

    def __init__(self, models, step=.5, pause=.5, longest=10.0, preroll=.25, preset='very_low'):
        self.asr, diar = models
        self.speakers = SpeakerTrack(diar, preset)
        self.step, self.pause, self.longest, self.preroll = int(step * RATE), int(pause * RATE), int(longest * RATE), int(preroll * RATE)
        self.buffer = np.zeros(0, dtype='float32')
        self.offset = 0          # session sample index of buffer[0]
        self.total = 0
        self.classified = 0      # session samples already through the voice detector
        self.start = None        # where the open stretch begins; None while nobody speaks
        self.voice_end = None    # end of the last voiced frame
        self.floor = 0           # end of the last closed stretch
        self.since = 0           # samples since the last partial decoding
        self.open_words = []
        self.closed = []         # (start, end, words) decoded stretches waiting for the diarizer
        self.turns = []
        self.partial = ''
        self.voice_audio = {}    # speaker -> clean speech for voice matching at the end, at most 30 s each
        self.finished = False
        self.backoff = 1         # partial re-reads are spaced out while decoding is slow

    def feed(self, samples, final=False):
        """Returns True when turns or the partial caption changed."""
        if self.finished:
            return False
        before = (len(self.turns), self.partial)
        if len(samples):
            self.buffer = np.concatenate([self.buffer, samples])
            self.total += len(samples)
            self.since += len(samples)
            self.speakers.feed(samples)
        if final:
            self.finished = True
            self.speakers.feed(np.zeros(0, dtype='float32'), final=True)
        self._listen(final)
        self._commit(final)
        self.partial = ' '.join(word[2] for stretch in self.closed for word in stretch[2])
        self.partial = ' '.join(part for part in (self.partial, ' '.join(word[2] for word in self.open_words)) if part)
        return before != (len(self.turns), self.partial)

    def _listen(self, final):
        count = (self.total - self.classified) // VAD_FRAME
        if count:
            first = self.classified - self.offset
            for index, voiced in enumerate(voiced_frames(self.buffer[first:first + count * VAD_FRAME])):
                if voiced:
                    at = self.classified + index * VAD_FRAME
                    if self.start is None:
                        self.start = max(self.floor, self.offset, at - self.preroll)
                    self.voice_end = at + VAD_FRAME
            self.classified += count * VAD_FRAME
        if self.start is None:
            self._trim(self.classified - self.preroll)
            return
        if final or self.classified - self.voice_end >= self.pause:
            self._close(self.total if final else min(self.voice_end + int(.15 * RATE), self.total))
            self.start = None
        elif self.classified - self.start >= self.longest:
            cut = self._quietest(max(self.start + RATE, self.classified - 2 * RATE), self.classified)
            self._close(cut)
            self.start = cut
        elif self.since >= self.step * self.backoff * (1 if self.classified - self.start < 5 * RATE else 2):
            # A long stretch is re-read half as often, and when the GPU is busy (the language model checking a
            # sentence) the words being spoken are re-read less often still, so committing never falls behind.
            self.since = 0
            started = time.perf_counter()
            self.open_words = self._decode(self.start, self.total)
            slow = time.perf_counter() - started > .25
            self.backoff = min(4, self.backoff * 2) if slow else max(1, self.backoff // 2)
            cut = self._sentence_cut(self.open_words)
            if cut is not None:
                self._close(cut)
                self.start = cut

    def _sentence_cut(self, words):
        """Where to close the open stretch early: before the first word after its last finished sentence that speech
        has moved well past, at the quietest moment just before that word (the recogniser stretches a sentence's last
        word to the next one, so the pause lies inside it). A long turn is then committed sentence by sentence."""
        settled = self.classified / RATE - .8
        for index in range(len(words) - 2, -1, -1):
            if words[index][3] and words[index + 1][0] <= settled:
                following = int(words[index + 1][0] * RATE)
                first = max(int(words[index][0] * RATE), following - int(.4 * RATE), self.start + VAD_FRAME)
                return self._quietest(first, following) if following - first >= VAD_FRAME else None
        return None

    def _decode(self, start, end):
        import mlx.core as mx
        audio = self.buffer[start - self.offset:end - self.offset]
        return words_of(self.asr.decode_chunk(mx.array(audio)), start / RATE) if len(audio) >= VAD_FRAME else []

    def _close(self, end):
        words = self._decode(self.start, end)
        if words:
            self.closed.append((self.start, end, words))
        self.open_words, self.floor, self.since = [], end, 0

    def _quietest(self, first, last):
        audio = self.buffer[first - self.offset:last - self.offset]
        count = len(audio) // VAD_FRAME
        if not count:
            return last
        energy = (audio[:count * VAD_FRAME].reshape(count, VAD_FRAME) ** 2).mean(axis=1)
        return first + int(energy.argmin()) * VAD_FRAME + VAD_FRAME // 2

    def _commit(self, final):
        while self.closed:
            start, end, words = self.closed[0]
            if not final and self.speakers.known_until < words[-1][1] + .05:
                break
            for turn in turns_of(words, self.speakers.label):
                self.turns.append(turn)
                self._keep_voice(turn)
            self.closed.pop(0)
        keep = min([self.classified - self.preroll] + [stretch[0] for stretch in self.closed]
                   + ([self.start] if self.start is not None else []))
        self._trim(keep)

    def _trim(self, sample):
        sample = max(self.offset, min(sample, self.total))
        self.buffer = self.buffer[sample - self.offset:]
        self.offset = sample

    def _keep_voice(self, turn):
        if turn['speaker'] == 'unassigned' or turn['end'] - turn['start'] < 1.5:
            return
        kept = self.voice_audio.setdefault(turn['speaker'], [])
        if sum(len(part) for part in kept) >= 30 * RATE:
            return
        first, last = int(turn['start'] * RATE) - self.offset, int(turn['end'] * RATE) - self.offset
        if first >= 0:
            kept.append(self.buffer[first:last].copy())

    def text(self):
        return ' '.join(turn['text'] for turn in self.turns)


def load_streaming_model():
    """Nemotron Speech Streaming EN in float32, as published (bfloat16 decoded about half as fast here)."""
    from mlx_audio.stt import load
    return load(STREAM_MODEL, revision=STREAM_REVISION)


def timed_session(model, delay_ms=560):
    """mlx-audio's Nemotron streaming session, reporting each token with the time of the frame that emitted it."""
    import mlx.core as mx
    from mlx_audio.stt.models.nemotron_asr import tokenizer
    from mlx_audio.stt.models.nemotron_asr.session import NemotronStreamingSession

    class TimedSession(NemotronStreamingSession):
        def reset(self):
            super().reset()
            self._base = 0

        def pending(self):
            chunk = self._encoder.chunk_mel * self.model.preprocessor_config.hop_length
            return bool(self._encoded) or self._queued >= chunk or (self._closed and not self._flushed)

        def step(self, *, max_decode_tokens=256):
            # The library's step, also returning each token's frame time on the session clock.
            if self.done:
                return []
            if not self._encoded and not self._flushed:
                self._ingest()
            out = []
            for _ in range(max_decode_tokens):
                if not self._encoded:
                    break
                feature = self._encoded[0][:, self._frame:self._frame + 1]
                if self._prediction is None:
                    token = mx.array([[self._last_token]], dtype=mx.int32) if self._last_token != self.model.blank_id else None
                    self._prediction = self.model.decoder(token, self._hidden)
                output, (h, c) = self._prediction
                hidden = (h.astype(feature.dtype), c.astype(feature.dtype))
                prediction = int(mx.argmax(self.model.joint(feature, output.astype(feature.dtype))))
                if prediction != self.model.blank_id:
                    self._last_token, self._hidden, self._prediction = prediction, hidden, None
                    mx.eval(*hidden)
                    text = tokenizer.decode([prediction], self.model.vocabulary)
                    if not self._has_text:
                        text = text.lstrip()
                    if text:
                        self._has_text = True
                        out.append((text, (self._base + self._frame) * FRAME_SECONDS))
                    self._symbols += 1
                if prediction == self.model.blank_id or (self.model.max_symbols is not None and self._symbols >= self.model.max_symbols):
                    self._frame += 1
                    self._symbols = 0
                    if self._frame == self._encoded[0].shape[1]:
                        self._base += self._encoded[0].shape[1]
                        self._encoded.popleft()
                        self._frame = 0
            if self._flushed and not self._encoded:
                self._done = True
            return out

    return TimedSession(model, transcription_delay_ms=delay_ms)


class StreamCaptions:
    """Captions from a cache-aware streaming recogniser: every token is final once emitted (nothing is decoded
    twice), so the words of the current sentence are shown as they come and the sentence is committed as a turn
    at its closing punctuation, or after a second without new words, once the diarizer has caught up with it."""

    def __init__(self, models, delay_ms=560, preset='very_low', pause=1.0, longest=12.0, session=None):
        model, diar = models
        self.session = session or timed_session(model, delay_ms)
        self.speakers = SpeakerTrack(diar, preset)
        self.pause, self.longest = pause, longest
        self.words = []          # [start, end, text, ends] of the sentence being spoken
        self.turns = []
        self.partial = ''
        self.total = 0
        self.finished = False
        self.voice = VoiceKeeper()

    def feed(self, samples, final=False):
        """Returns True when turns or the partial caption changed."""
        if self.finished:
            return False
        before = (len(self.turns), self.partial)
        if len(samples):
            self.session.feed(samples)
            self.speakers.feed(samples)
            self.voice.feed(samples)
            self.total += len(samples)
        if final:
            self.finished = True
            self.session.close()
            self.speakers.feed(np.zeros(0, dtype='float32'), final=True)
        while self.session.pending() and not self.session.done:
            for text, at in self.session.step():
                if text.startswith(' ') or not self.words or self.words[-1][3]:
                    self.words.append([max(0.0, at - FRAME_SECONDS), at, text.strip(), False])
                else:
                    self.words[-1][1] = at
                    self.words[-1][2] += text
                if self.words[-1][2].endswith(SENTENCE_END):
                    self.words[-1][3] = True
        self._commit(final)
        self.partial = ' '.join(word[2] for word in self.words)
        return before != (len(self.turns), self.partial)

    def _commit(self, final):
        heard = self.session._base * FRAME_SECONDS  # audio the recogniser has fully decoded
        known = self.speakers.known_until
        cut = len(self.words) if final else 0
        for index, word in enumerate(self.words):
            if final or word[1] > known - .05:
                break
            following = self.words[index + 1][0] if index + 1 < len(self.words) else None
            if word[3] or (following is None and heard - word[1] >= self.pause) or (following is not None and following - word[1] >= self.pause):
                cut = index + 1
        if not cut and self.words and self.words[-1][1] - self.words[0][0] > self.longest:
            cut = sum(1 for word in self.words if word[1] <= known - .05)
        if cut:
            for turn in turns_of(self.words[:cut], self.speakers.label):
                self.turns.append(turn)
                self.voice.keep(turn)
            self.words = self.words[cut:]

    def text(self):
        return ' '.join(turn['text'] for turn in self.turns)

    @property
    def voice_audio(self):
        return self.voice.kept


class VoiceKeeper:
    """Up to 30 s of each speaker's clean speech, from the last two minutes of audio, for voice matching."""

    def __init__(self, seconds=120):
        self.buffer = np.zeros(0, dtype='float32')
        self.offset = 0
        self.limit = seconds * RATE
        self.kept = {}

    def feed(self, samples):
        self.buffer = np.concatenate([self.buffer, samples])
        if len(self.buffer) > self.limit:
            drop = len(self.buffer) - self.limit
            self.buffer = self.buffer[drop:]
            self.offset += drop

    def keep(self, turn):
        if turn['speaker'] == 'unassigned' or turn['end'] - turn['start'] < 1.5:
            return
        kept = self.kept.setdefault(turn['speaker'], [])
        if sum(len(part) for part in kept) >= 30 * RATE:
            return
        first, last = int(turn['start'] * RATE) - self.offset, int(turn['end'] * RATE) - self.offset
        if first >= 0:
            kept.append(self.buffer[first:last].copy())


def voice_vectors(voice_audio):
    """Unit Resemblyzer embeddings per speaker from up to 20 s of their clean speech (at least 3 s)."""
    import voice_profiles
    from resemblyzer import VoiceEncoder, preprocess_wav
    if voice_profiles._encoder is None:
        voice_profiles._encoder = VoiceEncoder(device='cpu', verbose=False)
    result = {}
    for speaker, pieces in voice_audio.items():
        if not pieces:
            continue
        audio = preprocess_wav(np.concatenate(pieces)[:20 * RATE], source_sr=RATE)
        if len(audio) < 3 * RATE:
            continue
        vector = voice_profiles._encoder.embed_utterance(audio)
        result[speaker] = (vector / max(float(np.linalg.norm(vector)), 1e-8)).tolist()
    return result


def stretches(audio, pause=.5, longest=10.0, preroll=.25, tail=.15):
    """(start, end) samples of the stretches of speech in a recording, cut where the speaker pauses for `pause`
    seconds, or at the quietest moment of the last two seconds once a stretch reaches `longest`, as live captions are."""
    flags = voiced_frames(audio)
    found, start, last = [], None, None
    for index, voiced in enumerate(flags):
        at = index * VAD_FRAME
        if voiced:
            if start is None:
                start = max(found[-1][1] if found else 0, at - int(preroll * RATE))
            last = at + VAD_FRAME
        if start is None:
            continue
        if at + VAD_FRAME - last >= pause * RATE:
            found.append((start, min(last + int(tail * RATE), len(audio))))
            start = None
        elif at + VAD_FRAME - start >= longest * RATE:
            window = audio[at + VAD_FRAME - 2 * RATE:at + VAD_FRAME]
            count = len(window) // VAD_FRAME
            energy = (window[:count * VAD_FRAME].reshape(count, VAD_FRAME) ** 2).mean(axis=1)
            cut = at + VAD_FRAME - 2 * RATE + int(energy.argmin()) * VAD_FRAME + VAD_FRAME // 2
            found.append((start, cut))
            start = cut
    if start is not None:
        found.append((start, len(audio)))
    return found


def transcribe_audio(models, audio, progress=lambda stage: None):
    """Whole recording, read stretch by stretch as live captions are (speech cut at pauses, never longer than 10 s),
    with speakers from offline diarization. Reading two-minute parts instead lost whole quiet sentences in a recording
    made through the laptop microphone (recall 0.68 against 0.82 by stretches)."""
    import mlx.core as mx
    asr, diar = models
    duration = len(audio) / RATE
    progress('Recognising speech')
    if streaming(models):
        # The streaming recogniser reads the whole recording once, cache-aware, with its widest lookahead (1.12 s).
        words = words_of(asr.generate(mx.array(audio), att_context_size=[asr.default_att_context_size[0], 13]))
    else:
        words, found = [], stretches(audio)
        for index, (start, end) in enumerate(found):
            words += words_of(asr.decode_chunk(mx.array(audio[start:end])), start / RATE)
            if index % 50 == 0:
                progress(f'Recognising speech · {100 * index // max(len(found), 1)}%')
    progress('Telling speakers apart')
    diar.set_streaming_config('offline')
    output = diar.generate(mx.array(audio))
    track = SpeakerTrack.__new__(SpeakerTrack)
    track.probs = np.array(output.speaker_probs, dtype='float32')
    segments = turns_of(words, track.label, merge_gap=1.5)
    return [s for s in segments if s['end'] <= duration + 1], track
