"""The scripted test meetings of the live end-to-end tests, as 16 kHz WAV files, from `meeting.json` and `meeting2.json`.

    python3.11 make_meetings.py <out-dir>

Each turn is spoken by its macOS voice with `say -o` (written to a file, never played), after two seconds of lead-in
and with 1.5 s of silence between turns. The times of the files made here are written beside them (`<name>.json`), for
`e2e_live.py`. The committed JSON keeps the times of the files used on 3 November: there the voice Aman rendered turn 3
as 7.4 s of unintelligible speech and dropped "to Beta Cloud" from turn 6, which is why those turns were misheard;
rendered again later it speaks them correctly. The voices must be installed (System Settings > Accessibility >
Spoken Content).
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

RATE = 16000
HERE = Path(__file__).resolve().parent


def make(script, out):
    parts, at, made = [np.zeros(2 * RATE, dtype='float32')], 2.0, []
    with tempfile.TemporaryDirectory() as folder:
        for turn in json.loads(script.read_text()):
            path = Path(folder) / f"t{turn['turn']:02d}.wav"
            subprocess.run(['say', '-v', turn['voice'], '-o', str(path), '--data-format=LEI16@16000', turn['text']], check=True)
            audio = sf.read(path, dtype='float32')[0]
            made.append({**turn, 'start': round(at, 2), 'end': round(at + len(audio) / RATE, 2)})
            parts += [audio, np.zeros(int(1.5 * RATE), dtype='float32')]
            at += len(audio) / RATE + 1.5
    sf.write(out, np.concatenate(parts), RATE)
    out.with_suffix('.json').write_text(json.dumps(made, indent=1))


if __name__ == '__main__':
    target = Path(sys.argv[1])
    target.mkdir(parents=True, exist_ok=True)
    for name in ('meeting', 'meeting2'):
        make(HERE / f'{name}.json', target / f'{name}.wav')
