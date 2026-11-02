"""Explicit meeting question with conservative extractive live-answer grounding.

Session assertions/instructions never reach the answer generator. Displayed
factual items must be contiguous normalized spans of each cited original quote.
Unsupported paraphrases fail closed to noEvidence; citation IDs alone do not
establish support. This extraction gate is deliberately not semantic entailment.
"""
from temporal_support import quote_contains_text

NO_EVIDENCE = 'The reviewed knowledge does not support a grounded live answer.'
SESSION_WARNING = 'Live session text is provisional reference context and is not used as answer evidence or sent to the answer generator.'


def _no_evidence(result):
    return {**result, 'sections': [{'heading': 'Answer', 'items': [
        {'text': NO_EVIDENCE, 'citations': [], 'noEvidence': True}]}],
        'citations': [], 'message': NO_EVIDENCE}


def _ground_answer(result):
    evidence = {e['id']: e for e in result.get('citations', [])}
    sections, used = [], set()
    for section in result.get('sections', []):
        items = []
        for item in section.get('items', []):
            if item.get('noEvidence') is True:
                items.append({'text': NO_EVIDENCE, 'citations': [], 'noEvidence': True})
                continue
            refs = item.get('citations', [])
            if not refs or any(ref not in evidence or not quote_contains_text(
                    item.get('text'), evidence[ref].get('quote')) for ref in refs):
                result = _no_evidence(result)
                result['warnings'] = result.get('warnings', []) + [
                    'Live answer suppressed: displayed text was not an exact/normalized span of its cited quote. Unsupported paraphrases are rejected.']
                return result
            items.append({'text': item['text'], 'citations': refs})
            used.update(refs)
        sections.append({'heading': 'Answer', 'items': items})
    return {**result, 'sections': sections,
            'citations': [e for e in result.get('citations', []) if e['id'] in used]}


MEETING_HEADING = 'In this meeting'
MEETING_WARNING = 'From the live transcript: not reviewed and not approved. Check it against the recording.'
WINDOW = 60000  # characters of the live transcript the model reads; the oldest part drops off in large steps


def window(session):
    """The transcript the model reads: all of it up to WINDOW characters, then the last two thirds of WINDOW,
    starting at a line, so the cached part stays the same between questions until the next step."""
    if len(session) <= WINDOW:
        return session
    keep = session[-(WINDOW * 2 // 3):]
    return keep[keep.find('\n') + 1:] if '\n' in keep else keep


def meeting_live_ask(engine, request, tracked=None, reply=None):
    """Answer during a meeting: the approved value of a tracked item, read from the ledger, and what was said in
    this meeting, from the live transcript the language model keeps cached. Approved and unreviewed stay apart."""
    question, session = request['question'].strip(), request.get('sessionText', '')
    sections, citations, warnings = [], [], []
    if tracked is None:
        from ask_facts import tracked_answer
        tracked = lambda q: tracked_answer(engine, q, rules_only=True)
    found = tracked(question)
    if found:
        sections.append({'heading': 'Approved decision', 'items': [item for section in found['sections'] for item in section['items']]})
        citations = found.get('citations', [])
    if session.strip():
        if reply is None:
            from qwen_scoring import meeting_reply as reply
        text = reply(window(session), question)
        if text:
            sections.append({'heading': MEETING_HEADING, 'items': [{'text': text, 'citations': [], 'live': True}]})
            warnings.append(MEETING_WARNING)
    if not sections:
        return None
    return {'sections': sections, 'citations': citations, 'warnings': warnings,
            'message': ''}


def live_ask(engine, request, generator=None):
    if not isinstance(request, dict):
        raise ValueError('A short meeting question is required.')
    question = request.get('question')
    session = request.get('sessionText', '')
    if not isinstance(question, str) or not question.strip() or len(question) > 2000:
        raise ValueError('A short meeting question is required.')
    if not isinstance(session, str): raise ValueError('Session context must be text.')
    import os
    if generator is None and os.environ.get('MEMORIA_QWEN_SOCKET'):
        answered = meeting_live_ask(engine, request)
        if answered is not None:
            return answered
    def extractive(prompt):
        if generator is None:
            from engine import local_generator
            generate = local_generator()
        else:
            generate = generator
        return generate(prompt + '\nLIVE ANSWER: Extract text verbatim from a cited original quote. '
                        'Use contiguous spans only; preserve conditions and attribution. '
                        'Do not paraphrase. If unsupported, return the noEvidence item.')
    result = _ground_answer(engine.answer(question.strip(), generator=extractive))
    result['warnings'] = result.get('warnings', []) + [SESSION_WARNING]
    return result
