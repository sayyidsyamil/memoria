"""Adapter helpers; no model loading or vendor changes.

Parent temporal_service can call temporal_home(engine.root) BEFORE constructing
Service, valid_current(service) instead of facts_current(), and
supporting_evidence(fact) before presenting an inherited correction citation.
valid_at optionally accepts ledger microseconds for deterministic callers.
"""
import re
import unicodedata
from pathlib import Path

from memoria_engine.service import iso, now_us
from memoria_engine.ledger import canon


def contained_path(root, path):
    """Resolve a workspace path, rejecting symlinks including dangling links.

    The workspace root itself is canonicalized (macOS /var may be an alias).
    All components beneath it must be real paths, even for not-yet-created files.
    """
    root = Path(root).resolve()
    path = Path(path)
    if not path.is_absolute():
        path = root / path
    try:
        parts = path.relative_to(root).parts
    except ValueError:
        raise ValueError('Temporal storage escapes the workspace root.') from None
    current = root
    for part in parts:
        if part == '..':
            raise ValueError('Temporal storage escapes the workspace root.')
        current = current / part
        if current.is_symlink():
            raise ValueError('Temporal storage must not contain symlinks.')
    if not path.resolve().is_relative_to(root):
        raise ValueError('Temporal storage escapes the workspace root.')
    return path.resolve()


def temporal_home(root):
    """Validate the directory AND storage files before any reads or Service writes.

    Includes SQLite WAL/SHM/journal and registry temporary files: SQLite and the
    vendor may open those implicitly. Does not create any directory or file.
    """
    root = Path(root).resolve()
    home = contained_path(root, '.memoria-memory/temporal')
    if home.exists():
        for entry in home.iterdir():
            contained_path(root, entry)
    return home


def valid_current(service, valid_at=None):
    """Service-compatible fact rows for one valid-now instant, not open-ended future.

    Uses the latest transaction view of ledger.as_of. Call within the caller's
    read snapshot when consistency across slots is required. Leaves ledger open.
    """
    instant = now_us() if valid_at is None else valid_at
    ledger = service.pipe.ledger
    out = []
    for obj, attr in service.registry.slots():
        belief = ledger.as_of(obj, attr, valid_at=instant)
        if belief is None:
            continue
        history = ledger.history(obj, attr)
        fact = next((h for h in history if h['fact_id'] == belief.fact_id and not h['retracted']), None)
        if fact is None:
            continue
        row = service._fact(fact, obj, attr)
        timeline = [b for b in ledger.timeline(obj, attr) if b.valid_from <= instant]
        row.update(kind=service.registry.objects[obj].kind,
                   n_changes=sum(canon(a.value) != canon(b.value) for a, b in zip(timeline, timeline[1:])),
                   valid_from=iso(belief.valid_from))
        out.append(row)
    return out


def normalized_text(text):
    """Case/Unicode/whitespace normalization only; retain negation and qualifiers."""
    return ' '.join(unicodedata.normalize('NFKC', text).casefold().split())


def quote_contains_text(text, quote):
    """Conservative extraction gate, not semantic entailment of paraphrases.

    A displayed item must be one contiguous, word-bounded span in a single
    cited original quote. No stitching, inference, or numeric conversions.
    """
    if not isinstance(text, str) or not isinstance(quote, str):
        return False
    text, quote = normalized_text(text), normalized_text(quote)
    return bool(text and re.search(r'(?<!\w)' + re.escape(text) + r'(?!\w)', quote))


def supporting_evidence(fact):
    """Quoted evidence suitable for cues; corrected values require explicit support.

    Corrections inherit their predecessor's quote in the vendor ledger. For
    those rows accept only a direct subject/attribute equality with the corrected
    value. Suppress other syntax conservatively rather than trusting a verifier
    to turn a correction's inherited quote into evidence for a different value.
    """
    quoted = [e for e in fact.get('evidence', [])
              if isinstance(e.get('quote'), str) and e['quote'].strip()]
    if not fact.get('corrects'):
        return quoted
    value = fact.get('value')
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return []
    equality = (r'\s*(?:the\s+)?' + re.escape(fact['label']) + r"(?:'s)?\s+" +
                re.escape(fact['attribute']) + r'\s+(?:is set to|is|equals)\s+(.+?)\s*[.!]?\s*')
    supported = []
    for evidence in quoted:
        quote = re.split(r',?\s+replacing\b', evidence['quote'], maxsplit=1, flags=re.I)[0]
        match = re.fullmatch(equality, quote, re.I)
        if match and normalized_text(match[1]) == normalized_text(str(value)):
            supported.append(evidence)
    return supported
