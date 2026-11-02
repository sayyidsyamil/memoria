"""Save the 60-minute draft as a reviewed transcript exactly as the review screen does (same text,
source page and meeting record), without driving the UI while the Mac is in use. Speakers keep
their anonymous labels; nothing is edited."""
import hashlib
import json
import re
import sys
import time
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
MEMORY = Path.home() / 'Documents/memoria-workspace/src-tauri/resources/memory'
sys.path.insert(0, str(MEMORY))
from engine import Engine, clock, speaker_label, workspace_product  # noqa: E402

VAULT = HERE / 'vault'


def main():
    engine = Engine(VAULT)
    with engine.locked():
        record = workspace_product(engine, {'action': 'meetings'})[0]
    session = record['id']
    draft = json.loads((VAULT / '.memoria-recordings' / session / 'transcript-draft.json').read_text())
    draft.pop('speakerEmbeddings', None)
    turns = draft['segments']
    order = [s for s in dict.fromkeys(t['speaker'] for t in turns) if s != 'unassigned']
    text = '\n\n'.join(f"[{clock(t['start'])}{' · original interval; text timing unresolved' if t.get('contextTrimmed') else ''}] "
                       f"{speaker_label(t['speaker'], {}, order)}: {t['text']}" for t in turns)
    data = text.encode()
    title = f"{record['title']} — reviewed transcript"
    attachment = f"attachments/{int(time.time() * 1000)}-transcript-{session}.txt"
    (VAULT / 'attachments').mkdir(exist_ok=True)
    (VAULT / attachment).write_bytes(data)
    publication = str(uuid.uuid4())
    slug = re.sub(r'^-|-$', '', re.sub(r'[^a-zA-Z0-9-]+', '-', unicodedata.normalize('NFKD', title)))[:60] or 'source'
    source = f'source-{slug}-{publication}.md'
    page = (f"[Listen to meeting audio](<{record['audioPath']}>)\n\nReviewed by the user. Draft generated with MOSS-Transcribe-Diarize "
            f"and edited in review; speaker labels and audio-clock timestamps remain approximate.\n\n{text}")
    imported = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    (VAULT / source).write_text('\n'.join([
        '---', 'type: Source', '_organized: true', f'title: {json.dumps(title, ensure_ascii=False)}',
        f'source_filename: {json.dumps(f"transcript-{session}.txt")}', f'sha256: {hashlib.sha256(data).hexdigest()}',
        'extraction: text-only', f'imported_at: {json.dumps(imported)}', '---', f'# {title}', '',
        f'[Open original](<{attachment}>)', '', '## Page 1', '', page, '']))
    with engine.locked():
        saved = workspace_product(engine, {'action': 'save_meeting', 'record': {
            'id': session, 'title': record['title'], 'status': 'transcript-reviewed', 'audioPath': record['audioPath'],
            'turns': turns, 'names': {}, 'draft': {**draft, 'segments': turns}, 'profileIds': {}, 'marks': [],
            'transcriptPath': source}})
    engine.db.close()
    print(json.dumps({'source': source, 'turns': len(turns), 'speakers': order, 'recordBytes': len(json.dumps(saved)), 'status': saved['status']}))


if __name__ == '__main__':
    main()
