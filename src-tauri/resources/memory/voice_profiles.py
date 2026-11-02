"""Vault-local voice templates. Unknown/ambiguous matches stay unnamed."""
import json
import sqlite3
import uuid
from pathlib import Path

ENCODER = 'resemblyzer-0.1.4'
_encoder = None

def database(root):
    directory = Path(root) / '.memoria-memory'
    directory.resolve().relative_to(Path(root).resolve())
    directory.mkdir(exist_ok=True)
    path = directory / 'voices.sqlite'
    if path.is_symlink(): raise ValueError('Voice profile database cannot be a symlink')
    connection = sqlite3.connect(path)
    connection.execute('CREATE TABLE IF NOT EXISTS voices (id TEXT PRIMARY KEY, name TEXT NOT NULL, encoder TEXT NOT NULL, embedding TEXT NOT NULL)')
    return connection

def list_profiles(root):
    with database(root) as connection:
        return [{'id': row[0], 'name': row[1]} for row in connection.execute('SELECT id, name FROM voices ORDER BY name')]

def drop_draft_embeddings(root, session_id):
    """Remove the voice embeddings a transcription left in a meeting's draft. Once the review is saved they
    are no longer needed: a voice is kept only as a remembered profile, and only when the user opted in."""
    import os
    import tempfile
    directory = Path(root) / '.memoria-recordings' / str(uuid.UUID(session_id))
    directory.resolve().relative_to(Path(root).resolve())
    path = directory / 'transcript-draft.json'
    if not path.is_file():
        return {'dropped': False}
    draft = json.loads(path.read_text())
    if 'speakerEmbeddings' not in draft:
        return {'dropped': False}
    del draft['speakerEmbeddings']
    with tempfile.NamedTemporaryFile('w', dir=directory, delete=False, suffix='.tmp') as file:
        json.dump(draft, file, ensure_ascii=False, indent=2)
        file.flush(); os.fsync(file.fileno())
    os.replace(file.name, path)
    return {'dropped': True}

def forget_profiles(root):
    """Delete every remembered voice of this workspace (opt-in biometric data); transcripts keep their names."""
    with database(root) as connection:
        forgotten = connection.execute('SELECT COUNT(*) FROM voices').fetchone()[0]
        connection.execute('DELETE FROM voices')
    with database(root) as connection:
        connection.execute('VACUUM')  # do not leave deleted templates in free pages
    return {'forgotten': forgotten}

def speaker_embeddings(samples, segments):
    global _encoder
    import numpy as np
    from resemblyzer import VoiceEncoder, preprocess_wav
    if _encoder is None:
        _encoder = VoiceEncoder(device='cpu', verbose=False)
    encoder = _encoder
    result = {}
    for speaker in {segment['speaker'] for segment in segments}:
        if speaker == 'unassigned': continue
        pieces = []
        for segment in segments:
            if segment['speaker'] != speaker or segment['end'] - segment['start'] < 1.0: continue
            if any(other['speaker'] != speaker and other['start'] < segment['end'] and other['end'] > segment['start'] for other in segments): continue
            pieces.append(samples[int(segment['start'] * 16000):int(segment['end'] * 16000)])
            if sum(len(piece) for piece in pieces) >= 20 * 16000: break
        if not pieces: continue
        audio = preprocess_wav(np.concatenate(pieces)[:20 * 16000], source_sr=16000)
        if len(audio) < 3 * 16000: continue
        vector = encoder.embed_utterance(audio)
        result[speaker] = (vector / max(float(np.linalg.norm(vector)), 1e-8)).tolist()
    return result

def match_profiles(root, embeddings):
    import numpy as np
    with database(root) as connection:
        profiles = list(connection.execute('SELECT id, name, embedding FROM voices WHERE encoder=?', (ENCODER,)))
    matches = {}
    for speaker, embedding in embeddings.items():
        ranked = sorted([(float(np.dot(embedding, json.loads(row[2]))), row[0], row[1]) for row in profiles], reverse=True)
        if not ranked: continue
        score, identifier, name = ranked[0]
        margin = score - ranked[1][0] if len(ranked) > 1 else score
        # Conservative prototype thresholds; require held-out calibration per capture setup.
        if score >= .82 and margin >= .08:
            matches[speaker] = {'id': identifier, 'name': name, 'similarity': round(score, 3)}
    # Two distinct diarized voices claiming one profile is ambiguous, not an automatic merge.
    ids = [match['id'] for match in matches.values()]
    return {speaker: match for speaker, match in matches.items() if ids.count(match['id']) == 1}

def save_profiles(root, session_id, assignments):
    directory = Path(root) / '.memoria-recordings' / str(uuid.UUID(session_id))
    directory.resolve().relative_to(Path(root).resolve())
    draft = json.loads((directory / 'transcript-draft.json').read_text())
    embeddings = draft.get('speakerEmbeddings', {})
    saved, skipped = [], []
    with database(root) as connection:
        for assignment in assignments:
            speaker = assignment['speaker']
            name = str(assignment.get('name', '')).strip()
            if not name: continue
            if len(name) > 100: raise ValueError('Speaker name is too long')
            if speaker not in embeddings:
                skipped.append(speaker); continue
            identifier = assignment.get('profileId')
            if identifier:
                # Confirm existing identity without silently changing its voice template/name.
                if not connection.execute('SELECT id FROM voices WHERE id=?', (identifier,)).fetchone():
                    raise ValueError('Saved speaker profile no longer exists')
                saved.append(identifier); continue
            identifier = str(uuid.uuid5(uuid.UUID(session_id), speaker))
            connection.execute('INSERT OR IGNORE INTO voices VALUES (?,?,?,?)',
                               (identifier, name, ENCODER, json.dumps(embeddings[speaker])))
            saved.append(identifier)
    return {'saved': saved, 'skipped': skipped}
