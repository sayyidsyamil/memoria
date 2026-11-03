"""Support check: does the cited turn actually state the entry's item and value? One first-token YES/NO question per
write, asked of the same model; a filter keeps a write when log P(YES) - log P(NO) >= tau.

Different from research/firmness-gate (which asked whether the value was firmly decided, and was no better than random
thinning): this asks only about attribution, the commonest error in the October dev audit (a value written from a turn
that names neither the item nor the value: "Then we do it." -> teletext excluded; "Yeah, and single curved curved." ->
remote type). Suggestions that do name the item and value are meant to pass: firmness is not asked.
Question, context and examples were fixed before any app-path output on development data was read.
"""
from types import SimpleNamespace

from memoria_engine.pipeline import Pipeline

BEFORE, AFTER, CLIP = 3, 1, 300
SYSTEM = "You check which item and value a quoted meeting turn is about."
RULES = (
    "Does the marked turn (>>), read with the turns just before it, state or clearly refer to the ENTRY's item with the "
    "ENTRY's value?\n"
    "YES if it names the item or the option, or clearly refers back to them, and what it says matches the value, even "
    "if it is only a suggestion.\n"
    "NO if it is about a different item, gives a different value, or does not mention this item or value at all.\n"
    "Examples from another meeting series (entry: Caterer = Firm P; allowed: Firm P, Firm Q):\n"
    '>> "Fine, we go with Firm P." -> YES\n'
    '>> "Maybe Firm P, they were cheaper." -> YES\n'
    '"Shall we use Firm P for the lunch?" >> "Yes, let\'s do that." -> YES\n'
    '>> "Let\'s book Firm Q then." -> NO\n'
    '>> "The projector is broken again." -> NO\n'
    '"Room 4 is free on Friday." >> "Then we do it." -> NO\n'
)
TEMPLATE = "{rules}\nENTRY: {item} ({attribute}) = {value}; allowed: {allowed}\nEXCERPT:\n{excerpt}\n\nReply with one word: YES or NO."


def _clip(text):
    return text if len(text) <= CLIP else text[:CLIP].rsplit(" ", 1)[0] + " ..."


def messages(meeting, registry, d):
    turns = meeting.turns
    lines = []
    for t in turns[max(0, d.turn - BEFORE): d.turn + AFTER + 1]:
        marked = t.index == turns[d.turn].index
        lines.append(f"{'>> ' if marked else ''}{registry.people.get(t.speaker, t.speaker)}: {t.text if marked else _clip(t.text)}")
    spec = registry.objects[d.object_id]
    attribute = spec.attribute(d.attribute)
    allowed = ", ".join(attribute.values) if attribute.type == "enum" else attribute.type
    user = TEMPLATE.format(rules=RULES, item=spec.label, attribute=d.attribute, value=d.value, allowed=allowed, excerpt="\n".join(lines))
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]


def valid(meeting, registry, candidate):
    return Pipeline._classify(SimpleNamespace(registry=registry), meeting, candidate)


def score(meeting, registry, v, lm):
    """log P(YES) - log P(NO) for a valid disposition v (grounded turn, slot, value)."""
    record = lm.score(messages(meeting, registry, v), tag=f"support:{meeting.meeting_id}:{v.turn}")
    return record["logprobs"]["YES"] - record["logprobs"]["NO"]
