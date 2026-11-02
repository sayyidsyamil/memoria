"""Questions about a tracked value — what it is now, what it was on a date, how it changed —
answered from the reviewed decision ledger instead of wiki claims.

Read-only ledger snapshot, as for live checks. No model is called: answers are fixed sentences
over approved ledger values, and every statement cites the quoted evidence of the facts it states.
Questions that name no tracked item, or name only an attribute without asking about time, are
left to the wiki answer.
"""
import json
import re
import sqlite3
from datetime import date
from types import SimpleNamespace

CURRENT = re.compile(r"\b(now|current(?:ly)?|at the moment|today|latest|these days|still|presently|anymore)\b", re.I)
CHANGES = re.compile(r"\b(chang(?:e|ed|es|ing)|history|previous(?:ly)?|before|earlier|originally|used to|switch(?:ed)?|replac(?:e|ed|ing)|over time)\b", re.I)


def _names(attribute, question):
    return re.search(rf"\b{re.escape(attribute.casefold().replace('_', ' '))}s?\b", question.casefold()) is not None


def route_question(registry, question, today):
    """Which tracked slot and lookup a question asks for, or None. Reuses the evaluated rule router.
    A named item counts when the question also names the attribute or asks about time; an attribute
    named without its item counts only when it is the only such slot and the question asks about time."""
    from memoria_engine.fallback_router import fallback_route, parse_dates, N_CHANGES
    dates = parse_dates(question, today)
    temporal = bool(CURRENT.search(question) or CHANGES.search(question) or N_CHANGES.search(question) or dates)
    route = fallback_route(registry, today.isoformat(), question)
    if route.ok:
        kind, object_id, attribute, valid_at, tx_at = route.type, route.object_id, route.attribute, route.valid_at, route.tx_at
        if not temporal and not _names(attribute, question):
            return None  # A topic question such as "What did we discuss about the pilot?"
    else:
        slots = [(item.object_id, spec.name) for item in registry.objects.values() for spec in item.attributes
                 if _names(spec.name, question)]
        if len(slots) != 1 or not temporal:
            return None
        (object_id, attribute), tx_at = slots[0], None
        kind = 'n_changes' if N_CHANGES.search(question) else 'as_of_valid' if dates else 'current'
        valid_at = dates[0].isoformat() if dates else None
    if kind == 'current' and CHANGES.search(question) and not CURRENT.search(question):
        kind = 'history'
    return {'type': kind, 'object_id': object_id, 'attribute': attribute, 'valid_at': valid_at, 'tx_at': tx_at}


def _snapshot(home, registry):
    """Vendor read methods over a read-only ledger connection: no mkdir, schema, replay or registry install."""
    from memoria_engine.ledger import Ledger
    from memoria_engine.service import Service
    service = Service.__new__(Service)
    service.home, service.registry = home, registry
    ledger = Ledger.__new__(Ledger)
    ledger._db = sqlite3.connect(home.joinpath('ledger.sqlite').as_uri() + '?mode=ro', uri=True)
    ledger._db.row_factory = sqlite3.Row
    try:
        ledger._db.execute('PRAGMA query_only = ON')
        ledger._db.execute('BEGIN')  # one consistent view while meetings are being approved
        service.pipe = SimpleNamespace(ledger=ledger, meeting_of_source={
            source['source_id']: source['meeting_id'] for source in ledger.sources()})
    except Exception:
        ledger._db.close()
        raise
    return service


def _times(count):
    return 'once' if count == 1 else 'twice' if count == 2 else f'{count} times'


def tracked_answer(engine, question, today=None):
    """An Ask result (same shape as wiki answers) when the question is about a tracked value with
    approved facts, else None."""
    from engine import human_date, meeting_records, safe_path, title_of
    from memoria_engine.service import registry_from_json
    from temporal_support import temporal_home, valid_current, supporting_evidence
    home = temporal_home(engine.root)
    if not (home / 'registry.json').is_file() or not (home / 'ledger.sqlite').is_file():
        return None
    data = json.loads((home / 'registry.json').read_text())
    if not data.get('objects'):
        return None
    registry = registry_from_json(data)
    route = route_question(registry, question, today or date.today())
    if route is None:
        return None
    service = _snapshot(home, registry)
    try:
        slot = (route['object_id'], route['attribute'])
        history = [fact for fact in service.facts_history(*slot) if not fact.get('retracted')]
        if not history:
            return None  # Nothing approved for this slot yet: the wiki may still know something.
        label = registry.objects[route['object_id']].label
        attribute = route['attribute']
        records = {record['id']: record for record in meeting_records(engine)}
        citations = []

        def cite(evidence):
            """Ledger evidence as an Ask citation into the meeting's reviewed transcript."""
            ids = []
            for item in evidence[:2]:
                record = records.get(item.get('meeting'))
                if not record or not record.get('transcriptPath') or not isinstance(item.get('quote'), str):
                    continue
                path = record['transcriptPath']
                try:
                    source = safe_path(engine.root, path)
                    title = title_of(source, source.read_text())
                except (OSError, ValueError):
                    continue
                identifier = f'R{len(citations) + 1}'
                citations.append({'id': identifier, 'quote': item['quote'], 'sourcePath': path, 'sourceTitle': title, 'page': 1,
                                  'moment': {'meetingId': record['id'], 'meetingTitle': record.get('title', 'Meeting'), 'at': item.get('audio_start')}})
                ids.append(identifier)
            return ids

        items = []
        if route['type'] == 'current':
            fact = next((row for row in valid_current(service) if (row['object_id'], row['attribute']) == slot), None)
            if fact is None:
                items.append({'text': f'No {attribute} for {label} is in force now.', 'citations': [], 'noEvidence': True})
            else:
                items.append({'text': f"The current {attribute} for {label} is {fact['value']} (decided {human_date(fact['decided_at'])}).",
                              'citations': cite(supporting_evidence(fact))})
        elif route['type'] in ('as_of_valid', 'as_of_tx'):
            found = service.query(route['type'], *slot, valid_at=route['valid_at'], tx_at=route['tx_at'])
            on = route['valid_at']
            if found['answer'] is None:
                items.append({'text': f'No {attribute} for {label} was recorded for {on}.', 'citations': [], 'noEvidence': True})
            else:
                known = f", as recorded by {route['tx_at']}" if route['type'] == 'as_of_tx' and route['tx_at'] else ''
                items.append({'text': f"On {on}{known}, the {attribute} for {label} was {found['answer']} (decided {human_date(found['decided_at'])}).",
                              'citations': cite(found['evidence'])})
        else:  # n_changes and history: the recorded values in order, each with its own evidence
            changes = service.query('n_changes', *slot)['answer']
            values = ' → '.join(str(fact['value']) for fact in history)
            steps = []
            for fact in history:
                ids = cite(fact.get('evidence') or [])
                if ids:
                    steps.append({'text': f"{fact['value']} — decided {human_date(fact['decided_at'])}.", 'citations': ids})
            summary = f'The {attribute} for {label} has not changed: {values}.' if not changes else \
                f'The {attribute} for {label} changed {_times(changes)}: {values}.'
            items.append({'text': summary, 'citations': [ref for step in steps for ref in step['citations']]})
            items.extend(steps)
        if not any(item['citations'] for item in items) and not all(item.get('noEvidence') for item in items):
            return None
        lookup = {'current': 'current value', 'as_of_valid': 'value on a date', 'as_of_tx': 'value as recorded by a date',
                  'n_changes': 'number of changes', 'history': 'recorded history'}[route['type']]
        return {'sections': [{'heading': 'Answer', 'items': items}], 'citations': citations,
                'retrieval': f'Tracked facts · {label} — {attribute} · {lookup}', 'warnings': [], 'message': None, 'source': 'tracked-facts'}
    finally:
        service.pipe.ledger._db.close()
