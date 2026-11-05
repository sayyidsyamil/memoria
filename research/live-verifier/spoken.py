"""MemoriaBench, spoken: does the live check still work when the statement reaches it through speech recognition?

    MEMORIA_QWEN_SOCKET=... MEMORIA_EMBED_SOCKET=... python spoken.py <split> <out.jsonl>

Each probe statement is spoken by one of six macOS voices in turn (US, British, Australian, Irish, Indian and South
African English; `say`, 16 kHz, nothing is played aloud), recognised by the app's Parakeet Ultra, and the recognised
text is checked by the app's live check exactly as the text benchmark checks the written statement. The audio stays in
the temporary folder; the recognised text of every probe is saved beside the predictions.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'memoriabench'))
import app_live_check_bench as bench  # noqa: E402  (puts the app's memory folder on the path)

VOICES = ['Samantha', 'Daniel', 'Karen', 'Moira', 'Rishi', 'Tessa']
AUDIO = Path(os.environ.get('TMPDIR', '/tmp')) / 'memoria-spoken-bench'


def speak(probes):
    AUDIO.mkdir(exist_ok=True)
    clips = {}
    for index, probe in enumerate(probes):
        voice = VOICES[index % len(VOICES)]
        path = AUDIO / f"{probe['id']}.wav"
        if not path.exists():
            subprocess.run(['say', '-v', voice, '-o', str(path), '--data-format=LEI16@16000', probe['statement']], check=True)
        clips[probe['id']] = (voice, path)
    return clips


def recognise(clips):
    import mlx.core as mx
    import soundfile as sf
    import streaming_speech as S
    asr, _ = S.load_models()
    heard = {}
    for probe_id, (voice, path) in clips.items():
        audio = sf.read(path, dtype='float32')[0]
        started = time.perf_counter()
        text = ' '.join(word[2] for word in S.words_of(asr.decode_chunk(mx.array(audio))))
        heard[probe_id] = {'voice': voice, 'text': text, 'seconds': round(time.perf_counter() - started, 3),
                           'audioSeconds': round(len(audio) / S.RATE, 2)}
    return heard


def main(split, output):
    probes, provenance, memories = bench.load_inputs(split)
    transcripts = Path(output).with_suffix('.transcripts.json')
    if transcripts.exists():
        heard = json.loads(transcripts.read_text())
    else:
        heard = recognise(speak(probes))
        transcripts.write_text(json.dumps(heard, indent=1, ensure_ascii=False))
    spoken = [{**probe, 'written': probe['statement'], 'statement': heard[probe['id']]['text'] or '…'} for probe in probes]
    rows = bench.run(spoken, memories, provenance)
    with open(output, 'x') as out:
        for row in rows:
            row['voice'] = heard[row['id']]['voice']
            row['asrSeconds'] = heard[row['id']]['seconds']
            out.write(json.dumps(bench.finite_json(row), ensure_ascii=False) + '\n')
    summary = bench.summarise(rows)
    print(json.dumps(bench.finite_json(summary), indent=1))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
