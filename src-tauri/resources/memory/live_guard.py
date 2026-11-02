"""Semantic alert guard, adapted from research/memoriabench/guard.py.

Question wording and score threshold are identical; ledger rendering and lexical
selection differ. The app's exact numeric proof remains model-independent.
"""
import math
import os
from collections import Counter

MIN_SCORE = 1.0
CANDIDATES = 3

_SYSTEM = "You check one spoken statement against one approved decision from a project meeting."
_RULES = (
    "Does the STATEMENT clash with the DECISION?\n"
    "YES only if the STATEMENT is about the very same thing that the DECISION settles and goes against it: a different value, choice, date or market; "
    'a figure above a cap; the old option named in "(replaces ...)"; or the opposite (it denies or leaves out what the DECISION requires).\n'
    "NO if it is about a different thing (even when it shares a word, a number or a date), if it agrees with the DECISION, or if it is only a question, an idea or a remark.\n"
)
_EXAMPLES = (
    "Example 1, decision: Meeting room is Room 4 (replaces Room 9).\n"
    '"Let\'s book Room 9 again." -> YES\n'
    '"The room will be Room 7." -> YES\n'
    '"We will not use Room 4." -> YES\n'
    '"Room 4 is booked for Friday." -> NO\n'
    '"The hotel room cost ninety dollars." -> NO\n'
    "Example 2, decision: Snack budget is strictly $200.\n"
    '"The snacks will cost $260." -> YES\n'
    '"We spent $150 on snacks." -> NO\n'
    '"Should we add fruit to the snacks?" -> NO\n'
    '"My phone cost $260." -> NO\n'
)


def enabled():
    return os.environ.get('MEMORIA_GUARD', 'on').strip().lower() not in ('off', '0', 'no', 'false')


def question(statement, decision):
    return [
        {'role': 'system', 'content': _SYSTEM},
        {'role': 'user', 'content': f'{_RULES}{_EXAMPLES}\nDECISION: {decision}\nSTATEMENT: {statement}\n\nReply with one word: YES or NO.'},
    ]


def decision(fact):
    # Current slot is explicit: a quote's replacement tail is history, not another
    # current fact. Inputs are approved quoted data, never instructions.
    quote = next(e['quote'] for e in fact['evidence'] if isinstance(e.get('quote'), str) and e['quote'].strip())
    return f"{fact['label']} {fact['attribute']} is {fact['value']}. Approved quote: {quote}"


def candidates(statement, facts, tokens):
    """Top three current slots by IDF-weighted lexical overlap, stable on ties.

    Keep the app's literal number/currency tokens and explicit subject requirement;
    do not collapse differing units as the historical research prefilter did.
    """
    seen = [tokens(f"{f['label']} {f['attribute']}") for f in facts]
    frequency = Counter(word for words in seen for word in words)
    spoken = tokens(statement)
    ranked = [(sum(math.log(1 + len(facts) / frequency[w]) for w in spoken & words), i)
              for i, words in enumerate(seen)]
    return [facts[i] for score, i in sorted(ranked, key=lambda row: (-row[0], row[1])) if score > 0][:CANDIDATES]


def confirm(statement, cited, alternatives, score):
    """Return (confirmed fact or None, action); score enforces the call budget."""
    def ask(fact):
        value = score(question(statement, decision(fact)))
        if type(value) not in (int, float) or not math.isfinite(value):
            raise ValueError('Guard returned an invalid log-odds score.')
        return value

    if ask(cited) >= MIN_SCORE:
        return cited, 'confirmed'
    best, best_score = None, float('-inf')
    for fact in alternatives:
        if fact['fact_id'] == cited['fact_id']:
            continue
        value = ask(fact)
        if value > best_score:
            best, best_score = fact, value
    return (best, 'moved') if best_score >= MIN_SCORE else (None, 'dropped')
