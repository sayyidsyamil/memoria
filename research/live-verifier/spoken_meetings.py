"""MemoriaBench as spoken meetings: the live pipeline end to end, from audio to cue.

    MEMORIA_QWEN_SOCKET=... MEMORIA_EMBED_SOCKET=... python spoken_meetings.py <split> <out.jsonl>

Each series' statements become one meeting: spoken in a fixed shuffled order by the voices of `spoken.py` (the same
audio files), one second apart. The meeting is captioned by the app's `LiveTranscript` (fed in 0.256 s blocks, as the
meeting window sends audio), and every committed turn is checked by the app's live check against that series'
approved decisions, as the meeting window does. A statement counts as alerted when a turn overlapping it raised a cue.

Timing: `commitLag` is additional audio after the statement ended when its turn was committed; `checkSeconds` is the
check's wall time. Their sum (`statementEndToCue`) is an estimate, not measured real-time latency. This script feeds
audio as fast as processing permits and blocks feeding during checks. The sum excludes ASR compute time, queueing,
concurrent GPU contention and UI delivery. Use ../live-speech/e2e/e2e_live.py for paced installed-worker measurements.

`--room SNR[,RT60[,DRR]]` plays each meeting into a simulated room first: a synthetic impulse response (reverberation
time RT60 s, default 0.5; direct-to-reverberant ratio DRR dB, default 3) and pink noise SNR dB below the speech, both
seeded by the series.
"""
import json
import random
import sys
import time
from pathlib import Path
from types import SimpleNamespace
import tempfile

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'memoriabench'))
import app_live_check_bench as bench  # noqa: E402  (puts the app's memory folder on the path)
from live_assistance import live_check  # noqa: E402
import spoken  # noqa: E402

RATE = 16000
GAP = 1.0


def meeting_audio(probes, clips):
    """One recording per series: a second of silence, then each statement followed by a second of silence."""
    parts, spans, at = [np.zeros(RATE, dtype='float32')], {}, RATE
    for probe in probes:
        audio = sf.read(clips[probe['id']][1], dtype='float32')[0]
        spans[probe['id']] = (at / RATE, (at + len(audio)) / RATE)
        parts += [audio, np.zeros(int(GAP * RATE), dtype='float32')]
        at += len(audio) + int(GAP * RATE)
    return np.concatenate(parts + [np.zeros(RATE, dtype='float32')]), spans


def room(audio, spans, snr, seed, rt60=.5, drr=3.0):
    """Reverberation from an exponentially decaying noise tail behind the direct sound, then pink noise `snr` dB below
    the mean power of the statements."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(1.2 * rt60 * RATE)) / RATE
    tail = rng.standard_normal(len(t)) * np.exp(-6.9 * t / rt60)
    tail[:int(.002 * RATE)] = 0
    tail *= np.sqrt(10 ** (-drr / 10) / np.sum(tail ** 2))
    response = tail
    response[0] = 1.0
    size = 1 << int(np.ceil(np.log2(len(audio) + len(response))))
    wet = np.fft.irfft(np.fft.rfft(audio, size) * np.fft.rfft(response, size), size)[:len(audio)]
    white = np.fft.rfft(rng.standard_normal(len(audio)))
    pink = np.fft.irfft(white / np.sqrt(np.maximum(np.arange(len(white)), 1)), len(audio))
    speech = np.concatenate([wet[int(a * RATE):int(b * RATE)] for a, b in spans.values()])
    pink *= np.sqrt(np.mean(speech ** 2) / np.mean(pink ** 2) * 10 ** (-snr / 10))
    mixed = wet + pink
    return (mixed / max(1.0, np.abs(mixed).max() / .99)).astype('float32')


def caption_and_check(models, audio, root):
    import streaming_speech as S
    session, checked, seen = S.LiveTranscript(models), [], 0
    engine = SimpleNamespace(root=root)

    def check_new(now):
        nonlocal seen
        for turn in session.turns[seen:]:
            started = time.perf_counter()
            reply = live_check(engine, {'statement': turn['text']})
            data = reply.get('data', {})
            checked.append({**turn, 'committedAt': round(now, 2), 'cues': data.get('cues', []),
                            'status': data.get('status', 'error'), 'checkSeconds': round(time.perf_counter() - started, 3)})
        seen = len(session.turns)
    for index in range(0, len(audio), 4096):
        session.feed(audio[index:index + 4096])
        check_new(session.total / RATE)
    session.feed(np.zeros(0, dtype='float32'), final=True)
    check_new(session.total / RATE)
    return checked


def main(split, output, condition=None):
    import streaming_speech as S
    from worker_lifetime import limit_gpu_cache
    limit_gpu_cache()
    probes, provenance, memories = bench.load_inputs(split)
    clips = spoken.speak(probes)
    models = S.load_models()
    S.warm(models)
    rows, stray = [], []
    for series in sorted({p['series_id'] for p in probes}):
        order = [p for p in probes if p['series_id'] == series]
        random.Random(series).shuffle(order)
        audio, spans = meeting_audio(order, clips)
        if condition is not None:
            audio = room(audio, spans, *condition[:1], seed=int(''.join(ch for ch in series if ch.isdigit()) or 0), **dict(zip(('rt60', 'drr'), condition[1:])))
        with tempfile.TemporaryDirectory(prefix='memoria-spoken-meeting-') as folder:
            root = Path(folder)
            citation_of = bench.build_workspace(root, memories[series], provenance)
            turns = caption_and_check(models, audio, root)
        used = set()
        for probe in order:
            start, end = spans[probe['id']]
            mine = [i for i, t in enumerate(turns) if t['start'] < end + .3 and t['end'] > start - .3]
            used.update(mine)
            cued = [turns[i] for i in mine if turns[i]['cues']]
            first = cued[0] if cued else (turns[mine[-1]] if mine else None)
            rows.append({**probe, 'system': 'APP_LIVE_CHECK_SPOKEN_MEETING', 'alert': bool(cued),
                         'pred': 'CONTRADICTS' if cued else 'INSUFFICIENT_EVIDENCE',
                         'heard': ' | '.join(turns[i]['text'] for i in mine), 'turns': len(mine),
                         'sharedTurn': any(other != probe['id'] and spans[other][0] < turns[i]['end'] + .3 and spans[other][1] > turns[i]['start'] - .3
                                           for i in mine for other in spans),
                         'statementEnd': round(end, 2),
                         'commitLag': round(first['committedAt'] - end, 2) if first else None,
                         'checkSeconds': first['checkSeconds'] if first else None,
                         'latency_ms': first['checkSeconds'] * 1000 if first else 0,
                         'status': 'ok' if mine and all(turns[i]['status'] != 'error' for i in mine) else ('error' if mine else 'unheard'),
                         'citations': [citation_of.get(c['factId'], '') for t in cued for c in t['cues']]})
        stray += [{'series_id': series, 'text': t['text'], 'cues': len(t['cues'])} for i, t in enumerate(turns) if i not in used]
        print(f"{series}: {sum(r['alert'] for r in rows if r['series_id'] == series)} alerts, {len(turns)} turns", file=sys.stderr, flush=True)
    with open(output, 'x') as out:
        for row in rows:
            out.write(json.dumps(bench.finite_json(row), ensure_ascii=False) + '\n')
    summary = bench.summarise(rows)
    summary['timingMethod'] = 'Estimate: audio-time commit lag + check wall time; unpaced feed, no concurrent checks or UI'
    caught = [r for r in rows if r['expected_alert'] and r['alert'] and r['commitLag'] is not None]
    q = lambda values, p: round(float(np.percentile(values, p)), 2) if values else None
    summary['statementEndToCue'] = {'p50': q([r['commitLag'] + r['checkSeconds'] for r in caught], 50),
                                    'p95': q([r['commitLag'] + r['checkSeconds'] for r in caught], 95),
                                    'max': q([r['commitLag'] + r['checkSeconds'] for r in caught], 100), 'n': len(caught)}
    summary['commitLag'] = {'p50': q([r['commitLag'] for r in rows if r['commitLag'] is not None], 50),
                            'p95': q([r['commitLag'] for r in rows if r['commitLag'] is not None], 95)}
    summary['unheard'] = sum(r['status'] == 'unheard' for r in rows)
    summary['sharedTurns'] = sum(r['sharedTurn'] for r in rows)
    summary['strayTurns'] = len(stray)
    summary['strayCues'] = sum(s['cues'] > 0 for s in stray)
    print(json.dumps(bench.finite_json(summary), indent=1))


if __name__ == '__main__':
    args = sys.argv[1:]
    condition = [float(x) for x in args[args.index('--room') + 1].split(',')] if '--room' in args else None
    main(args[0], args[1], condition)
