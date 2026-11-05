"""Meeting application API. Inference is not part of record CRUD.

SQLite storage and generated document publication are coordinated here. A write-ahead
intent in the same database makes a crash between the two recoverable. Legacy actions
delegate to this service; inference stays in the memory engine.
"""
import math
import json
import os
import uuid


class MeetingError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def page_state(text):
    """How an intent names a page: the digest of its text, or 'absent'."""
    from engine import digest
    return 'absent' if text is None else digest(text)


class MeetingRepository:
    """SQLite record storage; the service coordinates generated documents.

    A save or delete first commits an intent (meeting_intents: page digests before and after, plus the new
    record for a save), then changes the page; the record and the end of the intent commit together.
    get and list settle any intent a crash left behind, so a record and its page never stay out of step.
    """
    def __init__(self, engine):
        self.engine = engine
        engine.db.execute('CREATE TABLE IF NOT EXISTS meetings (id TEXT PRIMARY KEY, record TEXT NOT NULL)')
        engine.db.execute('CREATE TABLE IF NOT EXISTS meeting_intents (id TEXT PRIMARY KEY, path TEXT NOT NULL, before_hash TEXT NOT NULL, after_hash TEXT NOT NULL, record TEXT)')

    def get(self, identifier):
        self.reconcile()
        row = self.engine.db.execute('SELECT record FROM meetings WHERE id=?', (identifier,)).fetchone()
        return json.loads(row[0]) if row else None

    def list(self):
        self.reconcile()
        return [json.loads(row[0]) for row in self.engine.db.execute('SELECT record FROM meetings ORDER BY rowid DESC')]

    def intend(self, identifier, path, before, after, record=None):
        """Step 1, committed before the page is touched. before and after are page texts; None means absent."""
        self.engine.db.execute('INSERT OR REPLACE INTO meeting_intents VALUES (?,?,?,?,?)',
                               (identifier, path, page_state(before), page_state(after), None if record is None else json.dumps(record)))
        self.engine.db.commit()

    def save(self, record):
        self.engine.db.execute('INSERT OR REPLACE INTO meetings VALUES (?,?)', (record['id'], json.dumps(record)))
        self.engine.db.execute('DELETE FROM meeting_intents WHERE id=?', (record['id'],))
        self.engine.db.commit()

    def delete(self, identifier):
        self.engine.db.execute('DELETE FROM meetings WHERE id=?', (identifier,))
        self.engine.db.execute('DELETE FROM meeting_intents WHERE id=?', (identifier,))
        self.engine.db.commit()

    def discard(self, identifier):
        self.engine.db.execute('DELETE FROM meeting_intents WHERE id=?', (identifier,))
        self.engine.db.commit()

    def reconcile(self):
        """Settle writes a crash interrupted, judging only by what each page holds now.

        Page in its after state: the change happened, so finish the record. Anything else is dropped and the
        page stays as it is: it is either still in its before state (the write never happened) or an outside
        edit, which the record's old pageHash keeps guarding. Pages are read here, never written.
        """
        from engine import safe_path
        for identifier, path, after, record in self.engine.db.execute('SELECT id,path,after_hash,record FROM meeting_intents').fetchall():
            try:
                target = safe_path(self.engine.root, path)
                current = page_state(target.read_text() if target.exists() else None)
            except UnicodeDecodeError: current = None  # not text this service wrote
            except (OSError, ValueError): continue  # cannot be inspected now; the intent waits for the next access
            if current != after: self.discard(identifier)
            elif record is None: self.delete(identifier)
            else: self.save(json.loads(record))


class MeetingService:
    def __init__(self, repository):
        self.repository = repository

    def identifier(self, value):
        try:
            return str(uuid.UUID(str(value)))
        except (ValueError, TypeError, AttributeError):
            raise MeetingError('INVALID_REQUEST', 'A valid meeting identifier is required.')

    def validate_record(self, value):
        if not isinstance(value, dict):
            raise MeetingError('INVALID_REQUEST', 'A meeting record is required.')
        allowed = {'id', 'title', 'status', 'audioPath', 'sourcePath', 'transcriptPath', 'created',
                   'draft', 'turns', 'names', 'profileIds', 'marks'}
        if set(value) - allowed:
            raise MeetingError('INVALID_REQUEST', 'The meeting record contains unsupported fields.')
        result = dict(value)
        result['id'] = self.identifier(value.get('id'))
        if result.get('status') not in ('needs-review', 'transcript-reviewed'):
            raise MeetingError('INVALID_REQUEST', 'A valid meeting status is required.')
        for key in ('audioPath', 'sourcePath', 'transcriptPath', 'created'):
            if key in result and result[key] is not None and not isinstance(result[key], str):
                raise MeetingError('INVALID_REQUEST', f'{key} must be text.')
        for key in ('names', 'profileIds'):
            mapping = result.get(key, {})
            if not isinstance(mapping, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in mapping.items()):
                raise MeetingError('INVALID_REQUEST', f'{key} must contain text labels.')
        turns = result.get('turns', [])
        if not isinstance(turns, list):
            raise MeetingError('INVALID_REQUEST', 'Transcript turns must be a list.')
        for turn in turns:
            if not isinstance(turn, dict) or not isinstance(turn.get('text'), str) or not isinstance(turn.get('speaker'), str):
                raise MeetingError('INVALID_REQUEST', 'Invalid transcript turn.')
            times = [turn.get('start'), turn.get('end')]
            if not all(isinstance(t, (int, float)) and not isinstance(t, bool) and math.isfinite(t) for t in times) or not 0 <= times[0] <= times[1]:
                raise MeetingError('INVALID_REQUEST', 'Transcript times must be finite and ordered.')
        return result

    def execute(self, request):
        from engine import outcome_status
        operation = request.get('operation')
        if operation == 'list':
            records = self.repository.list()
            proposals = self.repository.engine.list()
            for record in records:
                record['status'] = 'transcript-reviewed' if record.get('transcriptPath') else 'needs-review'
                record['outcomesStatus'] = outcome_status(proposals, record)
            return records
        if operation == 'get':
            record = self.repository.get(self.identifier(request.get('id')))
            if not record: raise MeetingError('MEETING_NOT_FOUND', 'Meeting not found')
            record['status'] = 'transcript-reviewed' if record.get('transcriptPath') else 'needs-review'
            record['outcomesStatus'] = outcome_status(self.repository.engine.list(), record)
            return record
        if operation == 'save':
            return self.save(self.validate_record(request.get('record')))
        if operation == 'delete':
            return self.delete(self.identifier(request.get('id')))
        raise MeetingError('INVALID_REQUEST', 'Unknown meeting operation.')

    def save(self, patch):
        from engine import safe_path, digest, atomic, now, human_date, clock, speaker_label
        root = self.repository.engine.root
        previous = self.repository.get(patch['id']) or {}  # get settles an interrupted write first, so the hash guard below sees the settled record
        record = {**previous, **patch}
        title = str(record.get('title', 'Meeting')).strip()
        if not title or len(title) > 200: raise MeetingError('INVALID_REQUEST', 'Invalid meeting title')
        for key in ('audioPath', 'sourcePath', 'transcriptPath'):
            if record.get(key) and not safe_path(root, record[key]).is_file(): raise MeetingError('INVALID_REQUEST', f'Meeting {key} does not exist')
        if record['status'] == 'transcript-reviewed' and not record.get('transcriptPath'):
            raise MeetingError('INVALID_REQUEST', 'Reviewed meeting requires a reviewed transcript')
        marks = record.get('marks') or []
        if not isinstance(marks, list) or len(marks) > 200: raise MeetingError('INVALID_REQUEST', 'Invalid marked moments')
        clean = []
        for mark in marks:
            moment = mark.get('at') if isinstance(mark, dict) else None
            label = str(mark.get('label', '')).strip() if isinstance(mark, dict) else ''
            if isinstance(moment, bool) or not isinstance(moment, (int, float)) or not math.isfinite(moment) or moment < 0 or len(label) > 120:
                raise MeetingError('INVALID_REQUEST', 'Invalid marked moment')
            clean.append({'id': str(mark.get('id') or uuid.uuid4()), 'at': float(moment), 'label': label})
        record['marks'] = sorted(clean, key=lambda item: item['at'])
        record['status'] = 'transcript-reviewed' if record.get('transcriptPath') else 'needs-review'
        # A three-hour meeting keeps its turns and draft (about 2-3 MB); the cap only bounds the request.
        if len(json.dumps(record)) > 8_000_000: raise MeetingError('INVALID_REQUEST', 'Meeting record exceeds size limit')
        path = f"meetings/meeting-{record['id']}.md"
        target = safe_path(root, path)
        before = target.read_text() if target.exists() else None
        if before is not None and previous.get('pageHash') != digest(before):
            raise MeetingError('MEETING_EXTERNALLY_MODIFIED', 'Meeting page was edited externally. Open the existing page; it was not overwritten.')
        when = f" · Recorded {human_date(record['created'])}" if record.get('created') else ''
        content = f"---\ntype: Meeting\n_organized: true\ntitle: {json.dumps(title)}\nmeeting_status: {record['status']}\n---\n# {title}\n\n{'Transcript reviewed' if record.get('transcriptPath') else 'Needs transcript review'}{when}\n"
        for key, label in [('audioPath', 'Recording'), ('sourcePath', 'Source'), ('transcriptPath', 'Reviewed transcript')]:
            if record.get(key): content += f"\n- [{label}](<{os.path.relpath(safe_path(root, record[key]), target.parent)}>)"
        if record['marks']:
            content += '\n\n## Marked moments\n\n' + '\n'.join(f"- {clock(mark['at'])} — {mark['label'] or 'Marked moment'}" for mark in record['marks'])
        if record.get('turns'):
            order = []
            content += '\n\n## Transcript\n\n' + '\n\n'.join(f"[{clock(turn['start'])}{' · original interval; text timing unresolved' if turn.get('contextTrimmed') else ''}] {speaker_label(turn['speaker'], record.get('names'), order)}: {turn['text']}" for turn in record['turns'])
        record.update(pagePath=path, pageHash=digest(content), updatedAt=now())
        try:
            self.repository.intend(record['id'], path, before, content, record)
            atomic(target, content)
            self.repository.save(record)
        except Exception:
            # A crash skips this handler; the intent lets the next access finish or discard the write instead.
            self.repository.engine.db.rollback()
            if target.exists() and digest(target.read_text()) == digest(content):
                if before is None: target.unlink()
                else: atomic(target, before)
            try: self.repository.discard(record['id'])
            except Exception: pass  # left pending, the next access settles it by what the page holds
            raise
        return record

    def delete(self, identifier):
        from engine import safe_path, digest, atomic
        record = self.repository.get(identifier)
        if not record: return {'deleted': False, 'id': identifier}
        path = f'meetings/meeting-{identifier}.md'
        if record.get('pagePath') != path: raise MeetingError('INVALID_REQUEST', 'Meeting document path is invalid')
        target = safe_path(self.repository.engine.root, path)
        content = target.read_text() if target.exists() else None
        if content is not None and digest(content) != record.get('pageHash'):
            raise MeetingError('MEETING_EXTERNALLY_MODIFIED', 'Meeting page was edited externally. Preserve those edits before deleting the meeting.')
        try:
            self.repository.intend(identifier, path, content, None)
            if content is not None: target.unlink()
            self.repository.delete(identifier)
        except Exception:
            self.repository.engine.db.rollback()
            if content is not None and not target.exists(): atomic(target, content)
            try: self.repository.discard(identifier)
            except Exception: pass  # left pending, the next access settles it by what the page holds
            raise
        return {'deleted': True, 'id': identifier}


def meeting_api(engine, request):
    try:
        return {'ok': True, 'data': MeetingService(MeetingRepository(engine)).execute(request)}
    except MeetingError as error:
        return {'ok': False, 'error': {'code': error.code, 'message': str(error)}}
    except ValueError as error:
        # Translate legacy persistence errors here, never in components or transport.
        message = str(error)
        code = 'MEETING_EXTERNALLY_MODIFIED' if 'edited externally' in message else 'MEETING_NOT_FOUND' if message == 'Meeting not found' else 'INVALID_REQUEST'
        return {'ok': False, 'error': {'code': code, 'message': message}}
    except Exception:
        return {'ok': False, 'error': {'code': 'PERSISTENCE_FAILED', 'message': 'The meeting could not be saved or removed. Existing evidence is preserved; please retry.'}}
