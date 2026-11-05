"""60-minute AMI fixture for the M2 long-meeting check: ES2004b (whole) + the start of ES2004c.

Writes es2004-60.wav (mono 16 kHz), original.webm (Opus, as the app records) and reference.json
(AMI manual words of all four participants on the fixture clock). AMI Meeting Corpus, CC BY 4.0.
"""
import json
import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
AMI = HERE / 'ami'
NS = '{http://nite.sourceforge.net/}'
TOTAL = 3600.0


def duration(path):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)]))


def words(meeting, offset, until):
    out = []
    for speaker in 'ABCD':
        root = ET.parse(AMI / 'annotations' / 'words' / f'{meeting}.{speaker}.words.xml').getroot()
        for element in root:
            text = (element.text or '').strip()
            if element.tag != 'w' or element.get('punc') == 'true' or not text or not element.get('starttime') or not element.get('endtime'):
                continue
            start, end = float(element.get('starttime')), float(element.get('endtime'))
            if start < until:
                out.append({'speaker': f'{meeting}.{speaker}', 'start': round(start + offset, 3), 'end': round(end + offset, 3), 'word': text})
    return out


def main():
    first = duration(AMI / 'audio' / 'ES2004b.wav')
    rest = TOTAL - first
    wav = HERE / 'es2004-60.wav'
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(AMI / 'audio' / 'ES2004b.wav'), '-i', str(AMI / 'audio' / 'ES2004c.wav'),
                    '-filter_complex', f'[1:a]atrim=0:{rest:.6f}[c];[0:a][c]concat=n=2:v=0:a=1[out]', '-map', '[out]',
                    '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(wav)], check=True)
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(wav), '-c:a', 'libopus', '-b:a', '48k', str(HERE / 'original.webm')], check=True)
    reference = sorted(words('ES2004b', 0.0, first) + words('ES2004c', first, rest), key=lambda w: (w['start'], w['end']))
    (HERE / 'reference.json').write_text(json.dumps({'source': 'AMI Meeting Corpus ES2004b + ES2004c (CC BY 4.0)', 'join': first,
                                                     'duration': TOTAL, 'words': reference}, indent=0))
    print(json.dumps({'wav': duration(wav), 'webm': duration(HERE / 'original.webm'), 'join': first, 'referenceWords': len(reference)}))


if __name__ == '__main__':
    main()
