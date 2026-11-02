"""Local fictional speech fixtures for native replay, not an ASR benchmark."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import wave

RATE = 16000
SCENARIOS = {
    'baseline': [
        'This is a fictional project meeting for a recording test.',
        'We decided to use Acme as supplier.',
        'The pilot budget is one hundred dollars.',
        'Maya owns the pilot.',
        'We will review the pilot on Friday.',
        'This is the final statement of the recording test.',
    ],
    'update': [
        'This is the second fictional project meeting.',
        'We are reviewing the supplier decision.',
        'We decided to use Beta as supplier.',
        'Maya still owns the pilot.',
        'The pilot budget is two hundred dollars.',
        'This is the final statement. The pilot budget is two hundred dollars.',
    ],
}


def create(destination):
    if not shutil.which('say') or not shutil.which('ffmpeg'):
        raise RuntimeError('These macOS fixtures require installed say and ffmpeg.')
    if destination.exists():
        raise FileExistsError('Use a new disposable output directory; existing fixtures are not overwritten.')
    destination.mkdir(parents=True)
    evidence = {'kind': 'fictional-prerecorded-native-input', 'voice': 'macOS Samantha', 'sampleRate': RATE,
                'microphone': False, 'externalService': False, 'accuracyEvaluation': False, 'fixtures': []}
    with tempfile.TemporaryDirectory(prefix='memoria-fictional-') as temporary:
        for name, sentences in SCENARIOS.items():
            samples = bytearray(b'\0' * RATE)  # Half a second before speech.
            intervals = []
            for index, text in enumerate(sentences):
                utterance = Path(temporary) / f'{name}-{index}.wav'
                subprocess.run(['say', '-v', 'Samantha', '-r', '145', '--file-format=WAVE',
                                '--data-format=LEI16@16000', '-o', str(utterance), text], check=True)
                pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(utterance), '-ar', str(RATE),
                                      '-ac', '1', '-f', 's16le', '-'], check=True, stdout=subprocess.PIPE).stdout
                start = len(samples) / (RATE * 2)
                samples.extend(pcm)
                intervals.append({'text': text, 'start': start, 'end': len(samples) / (RATE * 2)})
                samples.extend(b'\0' * RATE * 2 * 6)
            path = destination / f'{name}.wav'
            with wave.open(str(path), 'wb') as audio:
                audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(RATE); audio.writeframes(samples)
            evidence['fixtures'].append({'path': path.name, 'duration': len(samples) / (RATE * 2),
                                         'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'sentences': intervals})
    (destination / 'fixtures.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(evidence, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', required=True, type=Path)
    create(parser.parse_args().output_dir)
