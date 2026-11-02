"""Parakeet TDT v3 + Nemotron 3 Diarization on the 60-minute AMI hour (ES2004b + start of ES2004c).

    python bakeoff.py offline <out.json>   Parakeet TDT v3 over the whole recording ("Refine transcript and speakers")
    python bakeoff.py ultra <out.json>     the same with Parakeet Ultra (selcukkubur/parakeet-ultra-mlx)
    python bakeoff.py live <out.json>      Parakeet TDT v3 re-decoding the open sentence, fed 0.256 s chunks
    python bakeoff.py stream <out.json>    Nemotron Speech Streaming EN at 560 ms, fed 0.256 s chunks

The draft is scored with research/long-meeting/evaluate_transcript.py against the AMI words of the same span, the
scorer MOSS-Transcribe-Diarize was measured with on 2 November 2026 (Table 6.11 of the report). Live mode also
records when each committed turn appeared (in audio time after it ended) and the compute per decode.
"""
import io
import json
import os
import resource
import sys
import time
from contextlib import redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
MEMORY = HERE.parents[1] / 'src-tauri' / 'resources' / 'memory'
FIXTURE = Path('/private/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode/m2-long')
sys.path[:0] = [str(MEMORY), str(HERE.parent / 'long-meeting')]

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
import mlx.core as mx  # noqa: E402
import streaming_speech as S  # noqa: E402
import evaluate_transcript  # noqa: E402


def score(draft_path):
    evaluate_transcript.HERE = FIXTURE  # reference.json lives beside the fixture audio
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        evaluate_transcript.main(draft_path)
    report = json.loads(buffer.getvalue())
    purity = report['speakerPurity']
    labelled = sum(v['words'] for k, v in purity.items() if k != 'unassigned')
    right = sum(v['top'][0][1] for k, v in purity.items() if k != 'unassigned' and v['top'])
    return {'werFillersRemoved': report['fillersRemoved'], 'werWithFillers': report['withFillers'],
            'speakers': report['speakers'], 'labelledWordsOnTopPerson': round(right / max(labelled, 1), 4),
            'unassignedWords': purity.get('unassigned', {}).get('words', 0),
            'perSpeaker': {k: v for k, v in purity.items()}}


def main(mode, out):
    audio = sf.read(FIXTURE / 'es2004-60.wav', dtype='float32')[0]
    seconds = float(os.environ.get('BAKEOFF_SECONDS', 0)) or None
    if seconds:
        audio = audio[:int(seconds * S.RATE)]
    started = time.perf_counter()
    models = S.load_models()
    label = S.MODEL_LABEL
    if mode == 'ultra':
        import mlx.core as mx
        from mlx.utils import tree_map
        from mlx_audio.stt import load
        ultra = load('selcukkubur/parakeet-ultra-mlx')
        ultra.update(tree_map(lambda v: v.astype(mx.bfloat16) if v.dtype == mx.float32 else v, ultra.parameters()))
        models = (ultra, models[1])
        label = 'Parakeet Ultra + Nemotron 3 Diarization'
    if mode == 'stream':
        models = (S.load_streaming_model(), models[1])
        label = S.STREAM_LABEL
    S.warm(models)
    loaded = time.perf_counter() - started
    run = {'mode': mode, 'model': label, 'audioSeconds': len(audio) / S.RATE, 'loadSeconds': round(loaded, 1)}
    if mode in ('offline', 'ultra'):
        started = time.perf_counter()
        segments, _ = S.transcribe_audio(models, audio, progress=lambda stage: print(stage, file=sys.stderr, flush=True))
        run['processingSeconds'] = round(time.perf_counter() - started, 1)
    else:
        session = S.StreamCaptions(models) if mode == 'stream' else S.LiveTranscript(models)
        chunk, decodes, lag, seen = 4096, [], [], 0
        started = time.perf_counter()
        for index in range(0, len(audio), chunk):
            tick = time.perf_counter()
            changed = session.feed(audio[index:index + chunk])
            spent = time.perf_counter() - tick
            if spent > .02:
                decodes.append(spent)
            now = session.total / S.RATE
            for turn in session.turns[seen:]:
                lag.append(now - turn['end'])
            seen = len(session.turns)
            if index % (S.RATE * 300) < chunk:
                print(f'{now / 60:.0f} min, {len(session.turns)} turns', file=sys.stderr, flush=True)
        session.feed(np.zeros(0, dtype='float32'), final=True)
        run['processingSeconds'] = round(time.perf_counter() - started, 1)
        segments = session.turns
        q = lambda values, p: round(float(np.percentile(values, p)), 3) if values else None
        run['commitLagSeconds'] = {'p50': q(lag, 50), 'p90': q(lag, 90), 'p99': q(lag, 99), 'max': q(lag, 100), 'n': len(lag)}
        run['decodeSeconds'] = {'p50': q(decodes, 50), 'p95': q(decodes, 95), 'max': q(decodes, 100), 'n': len(decodes)}
    run['peakMlxGB'] = round(mx.get_peak_memory() / 1e9, 2)
    run['maxRssGB'] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9, 2)
    draft = {'segments': segments, 'duration': len(audio) / S.RATE, 'processingSeconds': run['processingSeconds'], 'model': label}
    Path(out).write_text(json.dumps(draft, ensure_ascii=False))
    run['score'] = score(out)
    print(json.dumps(run, indent=1))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
