"""Transcribe each five-minute part of the 60-minute fixture alone through the app's resident speech
worker, keeping MOSS's local speaker labels and each part's voice embeddings, so that joining the
parts (ownership, voice matching) can be compared offline without another hour of decoding."""
import json
import os
import subprocess
import sys
from pathlib import Path

import soundfile as sf

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(Path.home() / 'Documents/memoria-workspace/src-tauri/resources/memory'))
from transcript_chunks import plan_chunks, RATE  # noqa: E402

SESSION = '22222222-2222-4222-8222-222222222222'
VAULT = HERE / 'parts-vault'
FOLDER = VAULT / '.memoria-recordings' / SESSION
APP = Path.home() / 'Applications/Memoria Workspace.app/Contents/Resources/memory/transcribe.py'
PYTHON = Path.home() / 'Documents/memoria-workspace/.speech-runtime/bin/python'


def main():
    FOLDER.mkdir(parents=True, exist_ok=True)
    socket = next(Path(os.environ['TMPDIR']).glob(f"mm-{os.environ['APP_PID']}-*-speech.sock"))
    audio, _ = sf.read(HERE / 'es2004-60.wav', dtype='float32')
    parts = []
    for index, window in enumerate(plan_chunks(len(audio) / RATE)):
        path = FOLDER / f'part-{index + 1}.wav'
        sf.write(path, audio[round(window['start'] * RATE):round(window['end'] * RATE)], RATE, subtype='PCM_16')
        request = json.dumps({'action': 'transcribe', 'vaultPath': str(VAULT), 'sessionId': SESSION, 'audioPath': str(path)})
        output = subprocess.run([str(PYTHON), '-u', str(APP)], input=request, capture_output=True, text=True,
                                env={**os.environ, 'MEMORIA_SPEECH_SOCKET': str(socket)}, timeout=900).stdout
        result = json.loads(next(line for line in output.splitlines() if line.startswith('{"result"')))['result']
        draft = json.loads((FOLDER / 'transcript-draft.json').read_text())
        parts.append({'window': window, 'segments': result['segments'], 'embeddings': draft.get('speakerEmbeddings', {}),
                      'processingSeconds': result.get('processingSeconds')})
        print(index + 1, len(result['segments']), sorted(draft.get('speakerEmbeddings', {})), flush=True)
    (HERE / 'parts.json').write_text(json.dumps(parts))


if __name__ == '__main__':
    main()
