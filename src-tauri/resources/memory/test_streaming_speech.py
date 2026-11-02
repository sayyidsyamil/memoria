import unittest
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

import streaming_speech as S

RATE = S.RATE


def token(text, start, duration=.2):
    return SimpleNamespace(text=text, start=start, duration=duration)


def result(*sentences):
    return SimpleNamespace(sentences=[SimpleNamespace(tokens=list(tokens)) for tokens in sentences])


# A scripted meeting on the session clock: (start, end, speaker index, words with their start times).
SCRIPT = [
    (1.0, 2.6, 0, [(' Good', 1.0), (' morning', 1.4), (' everyone.', 2.0)]),
    (4.0, 6.0, 1, [(' The', 4.0), (' budget', 4.3), (' is', 4.8), (' now', 5.1), (' 300,000.', 5.5)]),
]


class FakeRecogniser:
    """Decodes the scripted words inside a window. Window samples hold their own session index, so the fake knows
    where the window starts; each decoding shifts word starts by a frame either way, like a real decoder."""

    def __init__(self):
        self.calls = 0

    def decode_chunk(self, window):
        window = np.array(window)
        start, end = window[0] / RATE, (window[-1] + 1) / RATE
        self.calls += 1
        jitter = .08 if self.calls % 2 else -.08
        sentences = []
        for _, _, _, words in SCRIPT:
            heard = [(text, at) for text, at in words if start - .05 <= at and at + .2 <= end]
            if heard:
                sentences.append([token(text, max(0.0, at - start + jitter)) for text, at in heard])
        return result(*sentences)


class FakeDiarizer:
    """Speaker activity from the script, 100 frames a second, 0.6 s behind the audio until the final flush."""

    def __init__(self):
        self.config = SimpleNamespace(num_speakers=4)

    def set_streaming_config(self, preset):
        self.preset = preset

    def init_streaming_state(self):
        return SimpleNamespace(received=0, emitted=0)

    def feed(self, samples, state, final=False):
        state.received += len(samples)
        known = state.received if final else max(0, state.received - int(.6 * RATE))
        frames = known // (RATE // 100) - state.emitted
        probs = np.zeros((max(frames, 0), 4), dtype='float32')
        for row in range(len(probs)):
            at = (state.emitted + row) / 100
            for start, end, speaker, _ in SCRIPT:
                if start <= at <= end:
                    probs[row, speaker] = .9
        state.emitted += len(probs)
        return SimpleNamespace(speaker_probs=probs), state


def speaking(samples):
    """Voice detection from the script: the samples hold their own session index."""
    count = len(samples) // S.VAD_FRAME
    starts = np.asarray(samples[:count * S.VAD_FRAME]).reshape(count, S.VAD_FRAME)[:, 0] / RATE
    return np.array([any(start <= at < end for start, end, _, _ in SCRIPT) for at in starts], dtype=bool)


def meeting(seconds):
    return np.arange(int(seconds * RATE), dtype='float32')


class StreamingSpeechTest(unittest.TestCase):
    def test_tokens_become_words_with_sentence_ends(self):
        words = S.words_of(result([token(' Good', 0), token(' mor', .3), token('ning', .5), token('.', .7, .1)],
                                  [token(' Next', 1.0)]), offset=10)
        self.assertEqual([(w[2], w[3]) for w in words], [('Good', False), ('morning.', True), ('Next', True)])
        self.assertAlmostEqual(words[1][0], 10.3)
        self.assertAlmostEqual(words[1][1], 10.8)

    def test_a_lone_space_token_separates_words(self):
        words = S.words_of(result([token(' now', 0), token(' ', .3), token('300', .4), token(',000.', .6)]))
        self.assertEqual([w[2] for w in words], ['now', '300,000.'])

    def test_turns_split_at_speakers_and_sentences_and_merge_for_review(self):
        words = [[0, .5, 'Yes.', True], [.6, 1, 'We', False], [1, 1.4, 'agree.', True], [1.5, 2, 'No.', True]]
        label = lambda start, end: 'S02' if start >= 1.5 else 'S01'
        self.assertEqual([t['text'] for t in S.turns_of(words, label)], ['Yes.', 'We agree.', 'No.'])
        merged = S.turns_of(words, label, merge_gap=1.5)
        self.assertEqual([(t['speaker'], t['text']) for t in merged], [('S01', 'Yes. We agree.'), ('S02', 'No.')])

    def test_speaker_is_the_most_active_over_the_word_or_nearby(self):
        track = S.SpeakerTrack.__new__(S.SpeakerTrack)
        track.probs = np.zeros((300, 4), dtype='float32')
        track.probs[100:200, 2] = .8
        self.assertEqual(track.label(1.2, 1.5), 'S03')
        self.assertEqual(track.label(2.1, 2.3), 'S03')   # just after the turn: nearest clear frame
        self.assertEqual(track.label(2.8, 2.9), 'unassigned')
        self.assertEqual(track.label(5.0, 5.2), 'unassigned')   # not diarized yet

    def live(self):
        recogniser = FakeRecogniser()
        session = S.LiveTranscript((recogniser, FakeDiarizer()))
        return session, recogniser

    def feed(self, session, audio, upto):
        events = []
        while session.total < int(upto * RATE):
            chunk = audio[session.total:session.total + 4096]
            if session.feed(chunk):
                events.append((session.total / RATE, len(session.turns), session.partial))
        return events

    @patch('streaming_speech.voiced_frames', speaking)
    def test_words_show_while_spoken_and_each_sentence_commits_about_a_second_after_it_ends(self):
        session, _ = self.live()
        audio = meeting(9)
        events = self.feed(session, audio, 9)
        partial_first = next(at for at, turns, partial in events if 'budget' in partial)
        committed = next(at for at, turns, _ in events if turns == 2)
        self.assertLess(partial_first, 5.5)
        self.assertLess(committed - 6.0, 1.6)
        self.assertEqual([(t['speaker'], t['text']) for t in session.turns],
                         [('S01', 'Good morning everyone.'), ('S02', 'The budget is now 300,000.')])
        self.assertEqual(session.partial, '')

    @patch('streaming_speech.voiced_frames', speaking)
    def test_silence_is_never_decoded(self):
        session, recogniser = self.live()
        silence = np.arange(int(30 * RATE), int(40 * RATE), dtype='float32')
        session.total = session.offset = session.classified = int(30 * RATE)
        for index in range(0, len(silence), 4096):
            session.feed(silence[index:index + 4096])
        self.assertEqual(recogniser.calls, 0)
        self.assertEqual(session.turns, [])
        self.assertLess(len(session.buffer), RATE)  # nothing kept but a short pre-roll

    @patch('streaming_speech.voiced_frames', lambda samples: np.ones(len(samples) // S.VAD_FRAME, dtype=bool))
    def test_a_stretch_without_pauses_is_cut_and_never_repeated(self):
        global SCRIPT
        words = [(f' w{i}', .5 + .4 * i) for i in range(60)]
        original, SCRIPT = SCRIPT, [(.4, 25.0, 0, words)]
        try:
            session, _ = self.live()
            audio = meeting(26)
            for index in range(0, len(audio), 4096):
                session.feed(audio[index:index + 4096])
            session.feed(np.zeros(0, dtype='float32'), final=True)
        finally:
            SCRIPT = original
        said = ' '.join(turn['text'] for turn in session.turns).split()
        self.assertEqual(len(said), len(set(said)))   # no word twice
        self.assertGreaterEqual(len(said), 55)          # and hardly any lost at the cuts
        self.assertGreater(len(session.turns), 1)

    @patch('streaming_speech.voiced_frames', speaking)
    def test_end_commits_the_words_still_being_spoken_once(self):
        session, _ = self.live()
        audio = meeting(5.4)
        self.feed(session, audio, 5.4)
        self.assertEqual(len(session.turns), 1)
        session.feed(np.zeros(0, dtype='float32'), final=True)
        self.assertEqual([t['text'] for t in session.turns], ['Good morning everyone.', 'The budget is now'])
        session.feed(np.zeros(0, dtype='float32'), final=True)
        self.assertEqual(len(session.turns), 2)



class FakeStream:
    """A cache-aware recogniser: tokens of the scripted words come out 0.56 s after they are spoken, never again."""

    def __init__(self, script):
        self.tokens = sorted(script, key=lambda token: token[1])
        self.received, self.closed, self.done, self._base = 0, False, False, 0

    def feed(self, samples):
        self.received += len(samples)

    def close(self):
        self.closed = True

    def pending(self):
        return any(at + .56 <= self.received / RATE or self.closed for _, at in self.tokens)

    def step(self):
        ready = [t for t in self.tokens if t[1] + .56 <= self.received / RATE or self.closed]
        self.tokens = [t for t in self.tokens if t not in ready]
        self._base = int(max(0.0, self.received / RATE - .56) / S.FRAME_SECONDS)
        if self.closed and not self.tokens:
            self.done = True
        return ready


class StreamCaptionsTest(unittest.TestCase):
    def captions(self):
        tokens = [(' Good', 1.2), (' morning', 1.6), (' everyone.', 2.2),
                  (' The', 4.1), (' budget', 4.4), (' is', 4.9), (' now', 5.2), (' 300', 5.5), (',000.', 5.7)]
        return S.StreamCaptions((None, FakeDiarizer()), session=FakeStream(tokens))

    def test_words_appear_as_spoken_and_sentences_commit_once_the_speaker_is_known(self):
        captions, events = self.captions(), []
        audio = meeting(9)
        for index in range(0, len(audio), 4096):
            if captions.feed(audio[index:index + 4096]):
                events.append((captions.total / RATE, len(captions.turns), captions.partial))
        first_budget = next(at for at, _, partial in events if 'budget' in partial)
        committed = next(at for at, turns, _ in events if turns == 2)
        self.assertLess(first_budget - 4.4, 1.0)
        self.assertLess(committed - 5.7, 1.6)
        self.assertEqual([(t['speaker'], t['text']) for t in captions.turns],
                         [('S01', 'Good morning everyone.'), ('S02', 'The budget is now 300,000.')])

    def test_end_commits_an_unfinished_sentence(self):
        captions = self.captions()
        audio = meeting(6.0)
        for index in range(0, len(audio), 4096):
            captions.feed(audio[index:index + 4096])
        captions.feed(np.zeros(0, dtype='float32'), final=True)
        self.assertEqual([t['text'] for t in captions.turns][-1], 'The budget is now 300,000.')
        self.assertEqual(captions.partial, '')

if __name__ == '__main__':
    unittest.main()
