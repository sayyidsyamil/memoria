"""Memoria's guard: what an alert must survive before it reaches the screen.

The auditor (memoria.check_statement) reads the whole decisions file and answers in one pass. On real speech about other things it was
wrong too often: asked about 616 sentences from interviews, lectures and product videos against five unrelated decisions, it raised an alert
on one sentence in six, usually "OUTDATED", citing a decision that had nothing to do with what was said. This module stands between its
reply and the card, and costs nothing when nothing is wrong:

  1. Relevance. A sentence that shares no meaningful word with any approved decision is not about any of them, so it is not audited at all
     (the answer is IRRELEVANT, at once). This is also what keeps the model idle during most of a meeting.
  2. Confirmation. When the auditor raises an alert, the same model is asked one narrow question: does this sentence clash with THIS
     decision? One decision, one question, a one-word answer, scored by how much more likely YES is than NO. Below MIN_SCORE the alert is
     dropped. The auditor reads a whole file and writes a reason; this reads one line, which is a much easier task for a small model.
  3. Attribution. When the decision the auditor cited does not confirm (or it cited nothing that exists), the decisions that share the
     most words with the sentence are asked in turn, and the one with the highest score at or above MIN_SCORE is cited instead.

An alert that comes out of this always names a decision that exists and that was checked against the sentence. Everything that is not
an alert is passed through as the auditor said it. MEMORIA_GUARD=off turns the guard off (the auditor's raw answers, for comparisons).

What this does and does not prove, with the numbers (MemoriaBench, real sentences from videos on four different ledgers, hand-written
look-alikes) and how the question and the threshold were chosen, is in GUARD.md.
"""

import math
import os
import re
import time
from collections import Counter

MIN_SCORE = 1.0  # log-odds of YES over NO: 1.0 means the model prefers YES by about 2.7 to 1
CANDIDATES = 3  # decisions asked about when the one the auditor cited does not confirm

ENABLED = os.environ.get("MEMORIA_GUARD", "on").strip().lower() not in ("off", "0", "no", "false")

ITEM = re.compile(r"^\s*[-*]\s*\[([^\]]+)\]\s*(.*)$")

STOP = set(
    """a an the and or but if then than so as of in on at to for from by with without into onto over under about up down out off is are was were be been being am do does did done doing
have has had having will would shall should can could may might must i you he she it we they me him her us them my your his its our their this that these those there here what which who whom
whose when where why how not no yes just also very really quite too much many some any each every all both more most less least only even still already again once now today
going gonna get got let lets make makes made like one two three four five six seven eight nine ten uh um okay ok well yeah right thing things way""".split()
)
MONEY = {"euro", "euros", "dollar", "dollars", "cent", "cents", "pound", "pounds", "usd", "eur", "$", "€", "£", "ringgit", "rm", "myr"}
FIGURE = "#"  # a number: it counts only together with a word, so it is never what makes two sentences "about the same thing"


def _stem(word: str) -> str:
    for suffix in ("ings", "ing", "edly", "ed", "ies", "es", "s", "ly"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            return word[: -len(suffix)] + ("y" if suffix == "ies" else "")
    return word


def tokens(text: str) -> set[str]:
    """The meaningful words of a sentence, lightly stemmed; any figure becomes FIGURE, any money word 'money', any quarter 'quarter'."""
    text = text.lower()
    text = re.sub(r"\b(first|second|third|fourth|1st|2nd|3rd|4th)\s+quarter\b", " quarter ", text)
    text = re.sub(r"\bq[1-4]\b", " quarter ", text)
    found: set[str] = set()
    for word in re.findall(r"[€$£]|[^\W\d_]+|\d+(?:[.,]\d+)?", text):
        if word in MONEY:
            found.add("money")
        elif word[0].isdigit():
            found.add(FIGURE)
        elif word not in STOP and len(word) >= 3:
            found.add(_stem(word))
    return found


def parse(decisions: str) -> list[tuple[str, str]]:
    """(id, text) of every decision bullet, in the order of the file; the id has no brackets, as memoria's citations."""
    return [(m.group(1), m.group(2)) for m in map(ITEM.match, decisions.splitlines()) if m]


def relevant(statement: str, items: list[tuple[str, str]]) -> bool:
    """True when the sentence shares a meaningful word with at least one decision."""
    spoken = tokens(statement) - {FIGURE}
    return any(spoken & tokens(text) for _, text in items)


def candidates(statement: str, items: list[tuple[str, str]], k: int = CANDIDATES) -> list[tuple[str, str]]:
    """The decisions that share words with the sentence, the best first: a word that few decisions have counts for more."""
    seen = [tokens(text) - {FIGURE} for _, text in items]
    document_frequency = Counter(word for words in seen for word in words)
    spoken = tokens(statement) - {FIGURE}
    scored = [(sum(math.log(1 + len(items) / document_frequency[w]) for w in spoken & words), i) for i, words in enumerate(seen)]
    ranked = sorted((s for s in scored if s[0] > 0), key=lambda s: (-s[0], s[1]))
    return [items[i] for _, i in ranked[:k]]


# --- the narrow question ---------------------------------------------------------------------------------------

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

_answers: dict[str, int] = {}


def question(statement: str, decision: str) -> list[dict]:
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": f"{_RULES}{_EXAMPLES}\nDECISION: {decision}\nSTATEMENT: {statement}\n\nReply with one word: YES or NO."},
    ]


def ask(messages: list[dict]) -> float:
    """How much more likely the auditor's own model finds YES than NO as the answer to a question put as chat messages (log-odds of the first token)."""
    import memoria
    import mlx.core as mx
    from mlx_lm.generate import generate_step

    model, tokenizer = memoria.load_model()
    if not _answers:
        _answers.update({word: tokenizer.encode(word, add_special_tokens=False)[0] for word in ("YES", "NO")})
    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    ids = mx.array(tokenizer.encode(prompt, add_special_tokens=tokenizer.bos_token is None or not prompt.startswith(tokenizer.bos_token)))
    with memoria._model_lock:  # MLX must not be driven from two threads at once
        for _token, logprobs in generate_step(ids, model, max_tokens=1, sampler=lambda x: mx.argmax(x, axis=-1), prefill_step_size=memoria.PREFILL_STEP):
            return float(logprobs[_answers["YES"]] - logprobs[_answers["NO"]])
    return float("-inf")


def confirm(statement: str, decision: str) -> float:
    """How much more likely the auditor's own model finds YES than NO to: does the statement clash with this decision?"""
    return ask(question(statement, decision))


# --- the guard ---------------------------------------------------------------------------------------------------


def _label_for(statement: str, decision: str) -> str:
    """OUTDATED when the statement uses what the decision says it replaced, else CONTRADICTS."""
    replaced = re.search(r"\(replaces ([^)]*)\)", decision)
    return "OUTDATED" if replaced and (tokens(statement) & (tokens(replaced.group(1)) - {FIGURE})) else "CONTRADICTS"


def check(statement: str, decisions: str, **ledger_args) -> dict:
    """The auditor's verdict on one sentence, after the guard: the same dictionary memoria.check_statement returns, plus 'guard' saying what
    the guard did: 'off', 'unrelated' (not audited), 'passed' (nothing to confirm), 'confirmed', 'moved' (another decision is cited) or
    'dropped' (the alert was not confirmed by any decision)."""
    import memoria  # looked up on every call: the model libraries are heavy, and tests replace its functions

    if not ENABLED:
        return {**memoria.check_statement(statement, **ledger_args), "guard": "off"}
    started = time.perf_counter()
    items = parse(decisions)
    if not items or not relevant(statement, items):
        return {"alert": False, "label": "IRRELEVANT", "reason": "", "citation": "", "latency_ms": (time.perf_counter() - started) * 1000, "guard": "unrelated"}

    result = memoria.check_statement(statement, **ledger_args)
    if not result["alert"]:
        return {**result, "guard": "passed"}

    text_of = dict(items)
    cited = result["citation"].strip("[]")
    if cited in text_of and confirm(statement, text_of[cited]) >= MIN_SCORE:
        return {**result, "latency_ms": (time.perf_counter() - started) * 1000, "guard": "confirmed"}

    best_score, best = None, ""
    for decision_id, text in candidates(statement, items):
        if decision_id == cited:
            continue  # it has just been asked about
        score = confirm(statement, text)
        if best_score is None or score > best_score:
            best_score, best = score, decision_id
    elapsed = (time.perf_counter() - started) * 1000
    if best_score is not None and best_score >= MIN_SCORE:
        return {"alert": True, "label": _label_for(statement, text_of[best]), "reason": f"Clashes with the approved decision {best}.", "citation": f"[{best}]",
                "latency_ms": elapsed, "guard": "moved"}
    return {"alert": False, "label": "INSUFFICIENT_EVIDENCE", "reason": "", "citation": "", "latency_ms": elapsed, "guard": "dropped"}
