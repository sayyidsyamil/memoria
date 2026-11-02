"""MemoriaBench as spoken meetings: the live pipeline end to end, from audio to cue.

    MEMORIA_QWEN_SOCKET=... MEMORIA_EMBED_SOCKET=... python spoken_meetings.py <split> <out.jsonl>

Each series' statements become one meeting: spoken in a fixed shuffled order by the voices of `spoken.py` (the same
audio files), one second apart. The meeting is captioned by the app's `LiveTranscript` (fed in 0.256 s blocks, as the
meeting window sends audio), and every committed turn is checked by the app's live check against that series'
approved decisions, as the meeting window does. A statement counts as alerted when a turn overlapping it raised a cue.

Latency: `commitLag` is how much audio had arrived after the statement ended when its turn was committed (independent
of how fast this script runs); `checkSeconds` is the check's own time. In the app the two add up, because checks start
as soon as a turn is committed.
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


def main(split, output):
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
    main(sys.argv[1], sys.argv[2])
