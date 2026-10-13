#!/usr/bin/env /opt/homebrew/bin/python3.11
"""On-device voice profile store for Memoria. Pure Python (numpy only for matching): no model, no mlx.

Voice profiles are biometric data, so the rules are strict:
  * Off (the default): nothing about voices is written anywhere. `save_session` returns "" and creates no folder.
  * On: after a meeting the embeddings of ALL speakers sit in one short-lived session file
    (`<base>/sessions/<id>.json`, owner-only permissions) until the user saves or closes the panel.
  * Enrolment keeps only the speakers the user named; every other embedding is dropped. The session file
    is deleted straight after enrolment, also when nobody was named, and also when the panel is closed
    without saving (`discard_session`). Files left behind by a crash are swept after SESSION_MAX_AGE_S.

Command line (used by the Rust backend, fast because no model is loaded):
    voice_store.py enroll <session-id> --labels '{"Speaker 0": "Aisha"}'
    voice_store.py discard <session-id>
    voice_store.py sweep
"""

import argparse
import json
import os
import re
import sys
import time
import uuid
from pathlib import Path

DEFAULT_BASE = Path.home() / ".memoria"
VOICES_FILE = "voices.json"
SESSIONS_DIR = "sessions"
MAX_SAMPLES_PER_VOICE = 6      # voiceprint history cap per person
SESSION_MAX_AGE_S = 6 * 3600   # leftover session files older than this are deleted
_ID = re.compile(r"^[0-9a-f]{1,32}$")


def _sessions(base):
    return Path(base) / SESSIONS_DIR


def _session_file(base, session_id):
    if not _ID.match(session_id or ""):
        return None   # never build a path from an unexpected id
    return _sessions(base) / f"{session_id}.json"


def load_voices(base=DEFAULT_BASE):
    try:
        return json.loads((Path(base) / VOICES_FILE).read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_voices(voices, base=DEFAULT_BASE):
    base = Path(base)
    base.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = base / VOICES_FILE
    path.write_text(json.dumps(voices))
    os.chmod(path, 0o600)


def best_match(emb, voices):
    """Return (name, score) of the closest enrolled voice, or (None, 0.0)."""
    import numpy as np
    best_name, best_score = None, 0.0
    for name, samples in voices.items():
        for ref in samples:
            score = float(np.dot(emb, np.array(ref, dtype=np.float32)))
            if score > best_score:
                best_name, best_score = name, score
    return best_name, best_score


def save_session(remember, embeddings, base=DEFAULT_BASE):
    """Keep every speaker's embedding until the user decides. Returns the session id ("" = nothing stored)."""
    if not remember or not embeddings:
        return ""
    session_id = uuid.uuid4().hex[:12]
    folder = _sessions(base)
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = folder / f"{session_id}.json"
    path.write_text(json.dumps({sid: list(map(float, emb)) for sid, emb in embeddings.items()}))
    os.chmod(path, 0o600)
    return session_id


def discard_session(session_id, base=DEFAULT_BASE):
    """Delete the session file. Safe to call twice."""
    path = _session_file(base, session_id)
    if path is not None:
        path.unlink(missing_ok=True)


def enroll_session(session_id, labels, base=DEFAULT_BASE):
    """Store the embeddings of the speakers the user named, drop the rest, delete the session file.

    Returns the list of names that were enrolled."""
    path = _session_file(base, session_id)
    if path is None:
        return []
    enrolled = []
    try:
        try:
            store = json.loads(path.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return []
        voices = load_voices(base)
        for speaker_id, name in (labels or {}).items():
            name = (name or "").strip()
            emb = store.get(speaker_id)
            if not name or name.startswith("Speaker ") or emb is None:
                continue
            samples = voices.setdefault(name, [])
            samples.append(emb)
            del samples[:-MAX_SAMPLES_PER_VOICE]
            enrolled.append(name)
        if enrolled:
            save_voices(voices, base)
    finally:
        path.unlink(missing_ok=True)
    return enrolled


def sweep_stale_sessions(base=DEFAULT_BASE, now=None, max_age_s=SESSION_MAX_AGE_S):
    """Remove session files left by a crash or a force quit. Returns how many were deleted."""
    now = time.time() if now is None else now
    removed = 0
    folder = _sessions(base)
    if not folder.is_dir():
        return 0
    for path in folder.glob("*.json"):
        try:
            if now - path.stat().st_mtime > max_age_s:
                path.unlink()
                removed += 1
        except FileNotFoundError:
            pass
    return removed


def delete_all(base=DEFAULT_BASE):
    """Remove the voiceprint store and every session file. Returns how many items were deleted."""
    base = Path(base)
    removed = 0
    voices = base / VOICES_FILE
    if voices.exists():
        voices.unlink()
        removed += 1
    folder = _sessions(base)
    if folder.exists():
        for path in folder.iterdir():
            path.unlink()
        folder.rmdir()
        removed += 1
    return removed


def main(argv=None, base=DEFAULT_BASE):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="command", required=True)
    enroll = sub.add_parser("enroll")
    enroll.add_argument("session_id")
    enroll.add_argument("--labels", default="{}")
    discard = sub.add_parser("discard")
    discard.add_argument("session_id")
    sub.add_parser("sweep")
    args = ap.parse_args(argv)
    if args.command == "enroll":
        enroll_session(args.session_id, json.loads(args.labels), base)
    elif args.command == "discard":
        discard_session(args.session_id, base)
    else:
        sweep_stale_sessions(base)
    return 0


if __name__ == "__main__":
    sys.exit(main())
