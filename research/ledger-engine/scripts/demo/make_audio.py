"""Synthesise the demo series as speech with macOS `say` (one voice per speaker), plus exact reference files.

    cd engine && python3.11 scripts/demo/make_audio.py

Writes data/demo/audio/meeting_N.wav (16 kHz mono), meeting_N.rttm (who spoke when, exact) and meeting_N.ref.txt (reference text).
The voices are synthetic: speech recognition and speaker separation on this audio are easier than on real rooms, so scores from it are an upper bound.
"""
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parents[1]
sys.path.insert(0, str(HERE))
from series import MEETINGS, PEOPLE, VOICES  # noqa: E402

OUT = ENGINE / "data" / "demo" / "audio"
RATE = 16000
PAUSE_SECONDS = (0.45, 0.75, 0.6, 0.9, 0.5)


def speak(text: str, voice: str, workdir: Path, name: str) -> np.ndarray:
    aiff, wav = workdir / f"{name}.aiff", workdir / f"{name}.wav"
    subprocess.run(["say", "-v", voice, "-o", str(aiff), "--", text], check=True)
    subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{RATE}", "-c", "1", str(aiff), str(wav)], check=True)
    with wave.open(str(wav)) as w:
        assert w.getframerate() == RATE and w.getnchannels() == 1
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for i, m in enumerate(MEETINGS, 1):
            pieces, rttm, ref, t = [], [], [], 0.0
            for k, (spk, text, _) in enumerate(m["turns"]):
                audio = speak(text, VOICES[spk], work, f"m{i}t{k}")
                dur = len(audio) / RATE
                rttm.append(f"SPEAKER meeting_{i} 1 {t:.3f} {dur:.3f} <NA> <NA> {PEOPLE[spk].replace(' ', '_')} <NA> <NA>")
                ref.append(f"{PEOPLE[spk]}: {text}")
                pause = PAUSE_SECONDS[k % len(PAUSE_SECONDS)]
                pieces += [audio, np.zeros(int(pause * RATE), dtype=np.int16)]
                t += dur + pause
            signal = np.concatenate(pieces)
            with wave.open(str(OUT / f"meeting_{i}.wav"), "wb") as w:
                w.setnchannels(1), w.setsampwidth(2), w.setframerate(RATE)
                w.writeframes(signal.tobytes())
            (OUT / f"meeting_{i}.rttm").write_text("\n".join(rttm) + "\n")
            (OUT / f"meeting_{i}.ref.txt").write_text("\n".join(ref) + "\n")
            print(f"meeting_{i}: {len(signal) / RATE / 60:.1f} min, {len(m['turns'])} turns")


if __name__ == "__main__":
    main()
