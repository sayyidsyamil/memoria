"""Keep Memoria's private vault folders out of version control.

Recordings (audio, transcript drafts with voice embeddings), remembered voices, the knowledge
journal and the tracked-fact ledger live in hidden folders inside the user's vault. A vault can be
a git repository with a remote, so each of these folders carries its own `.gitignore` that ignores
everything in it, itself included: nothing private is committed or pushed by accident.
"""
from pathlib import Path

IGNORE_ALL = '# Memoria private data (audio, voices, ledger): never committed.\n*\n'


def mark_private(directory):
    """Create `directory` if needed and make git ignore its whole content."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    marker = directory / '.gitignore'
    if not marker.exists():
        marker.write_text(IGNORE_ALL)
    return directory
