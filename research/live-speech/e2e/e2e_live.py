"""End-to-end live check through the installed app's own workers, without the UI (the screen may be locked).

    python3.11 e2e_live.py <app pid> <vault> <audio.wav> <reference.json> [--question "..."]

Feeds the WAV's samples to the app's speech worker in real time (nothing is played aloud), in the meeting window's
0.256 s PCM chunks, runs the
app's live check on every committed turn as the window's queue does (oldest first, one at a time, through engine.py and
the app's Qwen worker), then asks a Live Ask question. Prints when each sentence was committed and each cue raised,
measured from the end of the spoken sentence (reference.json), and the Live Ask answer and its time.
"""
import base64
import json
import os
import queue
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

import numpy as np
import soundfile as sf

MEMORY = Path('/Applications/Memoria.app/Contents/Resources/memory')
ENGINE_DIR = Path(os.environ.get('E2E_ENGINE_DIR', str(MEMORY)))
PY = '/Users/Shared/Memoria/runtime/speech/bin/python'
ENGINE_PY = '/Users/Shared/Memoria/runtime/speech/bin/python'


def sockets(pid):
    folder = Path(os.environ.get('TMPDIR', '/tmp'))
    found = {kind: next(iter(folder.glob(f'mm-{pid}-*-{kind}.sock')), None) for kind in ('speech', 'qwen', 'embed')}
    return {kind: str(path) for kind, path in found.items() if path}


def engine(request, socks, timeout=60):
    env = dict(os.environ, MEMORIA_QWEN_SOCKET=socks['qwen'], MEMORIA_EMBED_SOCKET=socks.get('embed', ''),
               PYTHONDONTWRITEBYTECODE='1', HF_HUB_OFFLINE='1')
    done = subprocess.run([ENGINE_PY, '-u', str(ENGINE_DIR / 'engine.py')], input=json.dumps(request), capture_output=True,
                          text=True, env=env, cwd=ENGINE_DIR, timeout=timeout)
    out = done.stdout
    for line in done.stderr.splitlines():
        if 'liveCheckTiming' in line:
            engine.timings.append(json.loads(line)['liveCheckTiming'])
    for line in reversed(out.strip().splitlines()):
        reply = json.loads(line)
        if 'result' in reply:
            return reply['result']
    raise RuntimeError(out[-500:])


engine.timings = []


def main(pid, vault, wav, reference_path, question):
    socks = sockets(pid)
    reference = json.loads(Path(reference_path).read_text())
    audio = sf.read(wav, dtype='float32')[0]
    env = dict(os.environ, MEMORIA_SPEECH_SOCKET=socks['speech'], PYTHONDONTWRITEBYTECODE='1', HF_HUB_OFFLINE='1')
    worker = subprocess.Popen([PY, '-u', str(MEMORY / 'live_speech.py')], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              text=True, env=env, cwd=MEMORY, bufsize=1)
    worker.stdin.write(json.dumps({'vaultPath': vault, 'sessionId': str(uuid.uuid4())}) + '\n')
    events, started, turns_seen, commits, cues = queue.Queue(), {}, [], {}, []

    def read():
        for line in worker.stdout:
            try:
                events.put(json.loads(line))
            except ValueError:
                pass
        events.put(None)
    threading.Thread(target=read, daemon=True).start()
    while True:
        event = events.get(timeout=120)
        if event is None or event.get('error'):
            raise SystemExit(f'speech worker: {event}')
        if event.get('stage') == 'Live captions ready':
            break
    checks = queue.Queue()
    texts = []
    timings = []

    def check():
        while True:
            turn = checks.get()
            if turn is None:
                return
            asked = time.time() - started['t']
            result = engine({'action': 'live_check', 'vaultPath': vault, 'statement': turn['text']}, socks)
            data = result.get('data', {})
            timings.append((round(asked, 2), round(time.time() - started['t'] - asked, 2), data.get('seconds'), turn['text'][:50], len(data.get('cues', [])), engine.timings[-1] if engine.timings else None))
            for cue in data.get('cues', []):
                cues.append({'heard': turn['text'], 'cue': f"{cue['label']} = {cue['currentValue']}",
                             'at': round(time.time() - started['t'], 2), 'asked': round(asked, 2), 'checkSeconds': data.get('seconds')})
    checker = threading.Thread(target=check, daemon=True)
    checker.start()
    started['t'] = time.time()
    chunk, index, partial_seen = 4096, 0, {}
    for offset in range(0, len(audio), chunk):
        due = started['t'] + offset / 16000
        while time.time() < due:
            time.sleep(.005)
        pcm = audio[offset:offset + chunk]
        worker.stdin.write(json.dumps({'index': index, 'data': base64.b64encode(pcm.astype('<f4').tobytes()).decode()}) + '\n')
        index += 1
        while not events.empty():
            event = events.get()
            if event is None:
                break
            now = time.time() - started['t']
            if event.get('partial'):
                for turn in reference:
                    if turn['turn'] not in partial_seen and turn['text'].split()[0].lower().strip('.,') in event['partial'].lower():
                        partial_seen[turn['turn']] = round(now, 2)
            for turn in (event.get('turns') or [])[len(turns_seen):]:
                turns_seen.append(turn)
                commits[len(turns_seen)] = (round(now, 2), turn)
                checks.put(turn)
    worker.stdin.write(json.dumps({'end': True, 'expectedChunks': index, 'expectedSamples': len(audio)}) + '\n')
    worker.stdin.flush()
    while True:
        event = events.get(timeout=120)
        for turn in ((event or {}).get('turns') or [])[len(turns_seen):]:
            turns_seen.append(turn)
            commits[len(turns_seen)] = (round(time.time() - started['t'], 2), turn)
            checks.put(turn)
        if event is None or event.get('done') or event.get('error'):
            break
    checks.put(None)
    checker.join(120)
    print('Committed turns (time after the audio started; +lag after the turn ended in the recording):')
    for number, (at, turn) in commits.items():
        print(f'  {at:6.2f}s  +{at - turn["end"]:4.2f}  {turn["speaker"]:10} {turn["text"]}')
    print('Checks (asked at, wall seconds, in-process seconds, sentence, cues):')
    for row in timings:
        print('  ', row)
    print('Cues:')
    for cue in cues:
        print(f"  {cue['at']:6.2f}s  {cue['cue']:28}  check {cue['checkSeconds']}s  heard: {cue['heard']}")
    transcript = '\n'.join(f"[{int(t['start'] // 60):02d}:{int(t['start'] % 60):02d}] {t['speaker']}: {t['text']}" for _, t in commits.values())
    for ask in question:
        t0 = time.time()
        answer = engine({'action': 'live_ask', 'vaultPath': vault, 'question': ask, 'sessionText': transcript}, socks)
        print(f'Ask ({time.time() - t0:.2f} s): {ask}')
        for section in answer.get('sections', []):
            for item in section['items']:
                print(f"   [{section['heading']}] {item['text']}")


if __name__ == '__main__':
    args = sys.argv[1:]
    asks = [args[i + 1] for i, a in enumerate(args) if a == '--question']
    main(int(args[0]), args[1], args[2], args[3], asks)
