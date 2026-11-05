"""Guard test: what stands between the auditor's reply and the card. No model is loaded: the auditor and the guard's own question are replaced.

Checked:
  - tokens(): meaningful words, lightly stemmed; figures, money and quarters are normalised; accented words stay whole;
  - parse(), relevant() and candidates(): which decisions a sentence is about, and which are asked about first;
  - the question put to the model is exactly the one that was measured (its wording is pinned by a hash: the thresholds were chosen with it);
  - check(): a sentence about no decision is not audited; an alert is kept only when the decision it cites confirms it; when that decision does
    not, another that shares the sentence's words may take its place, else the alert is dropped; what is not an alert passes untouched;
    MEMORIA_GUARD=off turns it all off.

Run: python3.11 test_guard.py
"""

import hashlib

import guard
import memoria

passed: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    assert condition, f"{name}: {detail}"
    passed.append(name)


LEDGER = """- [M1:08:21] Production cost cap is strictly \u20ac12.50 per unit.
- [M2:22:15] Case material is rubberized plastic.
- [M3:14:02] Power source is Kinetic charging (replaces Standard battery).
- [M3:30:10] Target market is Europe, launch deadline is strictly Q4.
"""
ITEMS = guard.parse(LEDGER)


def section_tokens() -> None:
    check("words are lower-cased and stemmed, and little words are left out", guard.tokens("We're still using the standard batteries.") == {"using", "standard", "battery"})
    check("a figure is one token, whatever it is, and money words are one token whatever the currency", guard.tokens("It costs \u20ac14,50 or 14 dollars per unit.") >= {"#", "money", "cost", "unit"})
    check("every way of saying a quarter is the same word", guard.tokens("the fourth quarter") & guard.tokens("launch in Q2") == {"quarter"} and "quarter" in guard.tokens("1st quarter"))
    check("accented words are not cut at the accent", guard.tokens("Caf\u00e9 in M\u00fcnchen") == {"caf\u00e9", "m\u00fcnchen"})
    check("nothing is left of small talk", guard.tokens("Yeah, so, um, it is what it is.") == set())


def section_lexical() -> None:
    check("a decision's id is read without its brackets, with its text and whatever it replaces", ITEMS[2] == ("M3:14:02", "Power source is Kinetic charging (replaces Standard battery)."))
    check("lines that are not bullets are not decisions", guard.parse("# Decisions\n\n- [M1:00:01] Cost is low.\nnotes [M9:00:01] here\n") == [("M1:00:01", "Cost is low.")])
    check("a decision with an id that has a suffix keeps it", guard.parse("- [ES2002b:28:58#2] The remote will have a joystick.") == [("ES2002b:28:58#2", "The remote will have a joystick.")])

    about = {
        "Unit cost will come to fourteen euros.": ["M1:08:21"],
        "Let's go back to the old battery design.": ["M3:14:02"],
        "We will launch in the second quarter.": ["M3:30:10"],
        "Right, we will make the case out of titanium.": ["M2:22:15"],
    }
    for statement, expected in about.items():
        check(f"relevant, and the decision it is about comes first: {statement}", guard.relevant(statement, ITEMS) and [c for c, _ in guard.candidates(statement, ITEMS)][:1] == expected, guard.candidates(statement, ITEMS))
    for statement in ("My grandmother makes the best pancakes.", "Hello there.", "Yeah, so, um, it is what it is.", "The weather in KL is really hot today."):
        check(f"not about any decision: {statement}", not guard.relevant(statement, ITEMS) and guard.candidates(statement, ITEMS) == [])
    check("a figure alone is never what a sentence has in common with a decision", not guard.relevant("It is 12 degrees outside, 50 at most.", ITEMS))
    shared = guard.parse("- [A:1] Budget for travel is capped.\n- [B:1] Budget for catering is low.\n- [C:1] Venue is a harbour.\n")
    check("a word that few decisions have counts for more: 'harbour' (in one) beats 'budget' (in two)", [c for c, _ in guard.candidates("budget harbour", shared)] == ["C:1", "A:1", "B:1"], guard.candidates("budget harbour", shared))
    check("at most the number of candidates asked for", len(guard.candidates("battery cost case launch", ITEMS, 2)) == 2)
    check("with no decisions nothing is relevant", not guard.relevant("The battery is dead.", []))
    check("an empty or blank sentence is about nothing", not guard.relevant("", ITEMS) and not guard.relevant("   ", ITEMS) and guard.candidates("", ITEMS) == [])
    check("a decisions file with Windows line ends is read the same", guard.parse("- [M1:00:01] Cost is low.\r\n- [M1:00:02] Size is small.\r\n") == [("M1:00:01", "Cost is low."), ("M1:00:02", "Size is small.")])
    check("a very long sentence is no problem", guard.relevant("battery " * 5000, ITEMS))


def section_question() -> None:
    messages = guard.question("We're still using standard batteries.", "Power source is Kinetic charging (replaces Standard battery).")
    digest = hashlib.sha256((messages[0]["content"] + "\n" + messages[1]["content"]).encode()).hexdigest()
    check("the question is the one the threshold was measured with (change its wording and the measurements no longer hold)", digest == "1c08afee455734b819652f7472625445aa3365cbb28291d4b32376ac512a587a", digest)
    check("it names one decision and one statement and asks for one word", "DECISION: Power source" in messages[1]["content"] and "STATEMENT: We're still" in messages[1]["content"] and messages[1]["content"].endswith("Reply with one word: YES or NO."))


class Stub:
    """Replaces the auditor and the guard's question for one test, and records how they were used."""

    def __init__(self, verdict: dict, scores: dict[str, float] | None = None):
        self.verdict, self.scores = verdict, scores or {}
        self.audited: list[str] = []
        self.asked: list[tuple[str, str]] = []

    def __enter__(self):
        self.real = memoria.check_statement, guard.confirm
        memoria.check_statement = lambda statement, **args: self.audited.append(statement) or dict(self.verdict)
        guard.confirm = lambda statement, decision: self.asked.append((statement, decision)) or next((v for k, v in self.scores.items() if k in decision), -9.0)
        return self

    def __exit__(self, *exc):
        memoria.check_statement, guard.confirm = self.real


def alert(label: str = "OUTDATED", citation: str = "[M3:14:02]") -> dict:
    return {"alert": True, "label": label, "reason": "because", "citation": citation, "latency_ms": 5.0}


def section_check() -> None:
    battery = "We are still using the standard battery."

    with Stub(alert(), {"Kinetic": 6.0}) as stub:
        result = guard.check(battery, LEDGER)
    check("an alert that the decision it cites confirms is kept exactly as the auditor made it, and the question was about that decision only", result["alert"] and result["label"] == "OUTDATED" and result["citation"] == "[M3:14:02]" and result["reason"] == "because" and result["guard"] == "confirmed" and len(stub.asked) == 1 and "Kinetic" in stub.asked[0][1], (result, stub.asked))

    with Stub(alert(), {"Kinetic": guard.MIN_SCORE}) as stub:
        result = guard.check(battery, LEDGER)
    check("a score of exactly MIN_SCORE confirms", result["alert"] and result["guard"] == "confirmed")
    with Stub(alert(), {"Kinetic": guard.MIN_SCORE - 0.01}) as stub:
        result = guard.check(battery, LEDGER)
    check("and a hair less does not: with no other decision that shares a word, the alert is dropped and says so", not result["alert"] and result["label"] == "INSUFFICIENT_EVIDENCE" and result["citation"] == "" and result["reason"] == "" and result["guard"] == "dropped", result)

    with Stub({"alert": False, "label": "SUPPORTED_CURRENT", "reason": "", "citation": "", "latency_ms": 5.0}) as stub:
        result = guard.check(battery, LEDGER)
    check("what is not an alert passes untouched and nothing is asked", result["label"] == "SUPPORTED_CURRENT" and not result["alert"] and result["guard"] == "passed" and stub.asked == [])

    with Stub(alert()) as stub:
        result = guard.check("My grandmother makes the best pancakes.", LEDGER)
    check("a sentence about no decision is not audited and not asked about: IRRELEVANT, at once", stub.audited == [] and stub.asked == [] and not result["alert"] and result["label"] == "IRRELEVANT" and result["guard"] == "unrelated" and result["latency_ms"] < 50, (result, stub.audited))

    with Stub(alert()) as stub:
        result = guard.check(battery, "")
    check("with no decisions there is nothing to audit against", stub.audited == [] and not result["alert"] and result["guard"] == "unrelated")

    # the auditor cited a decision that does not confirm; another one that shares the sentence's words does
    statement = "Right, we will make the case out of titanium."
    with Stub(alert("CONTRADICTS", "[M3:14:02]"), {"rubberized": 4.2, "Kinetic": -2.0}) as stub:
        result = guard.check(statement, LEDGER)
    check("when the cited decision does not confirm, the decision that does is cited instead, with a reason that says so", result["alert"] and result["citation"] == "[M2:22:15]" and result["guard"] == "moved" and "M2:22:15" in result["reason"] and result["label"] == "CONTRADICTS", result)
    check("and the decision cited first is not asked about twice", [d for _, d in stub.asked].count(ITEMS[2][1]) <= 1 and all("Kinetic" not in d for _, d in stub.asked[1:]), stub.asked)

    with Stub(alert("CONTRADICTS", "[M9:99:99]"), {"rubberized": 3.0}) as stub:
        result = guard.check(statement, LEDGER)
    check("a citation that does not exist is not asked about; the decisions that share the sentence's words are", result["alert"] and result["citation"] == "[M2:22:15]" and result["guard"] == "moved" and len(stub.asked) == 1, (result, stub.asked))

    with Stub(alert("CONTRADICTS", ""), {"Case material": 0.2}) as stub:
        result = guard.check(statement, LEDGER)
    check("an alert that cites nothing and that no decision confirms is dropped", not result["alert"] and result["guard"] == "dropped", result)

    with Stub(alert("CONTRADICTS", "[M2:22:15]"), {"Kinetic": 5.0, "rubberized": -1.0, "Production": 3.0}) as stub:
        result = guard.check("Power cost of the battery will be fine.", LEDGER)
    check("the best of the decisions asked about wins, not the first", result["alert"] and result["citation"] == "[M3:14:02]", result)

    with Stub(alert("CONTRADICTS", "[M2:22:15]"), {"Kinetic": 5.0}) as stub:
        result = guard.check("We will keep the standard battery.", LEDGER)
    check("a decision moved to that replaces something the sentence uses is OUTDATED, otherwise CONTRADICTS", result["label"] == "OUTDATED" and guard._label_for("We will use a solar panel.", ITEMS[2][1]) == "CONTRADICTS" and guard._label_for("We will pay 5.", ITEMS[0][1]) == "CONTRADICTS", result)

    # every decision costs one question: a ledger with many decisions that share a word still asks about three at most
    big = "\n".join(f"- [M{i}:00:01] The battery of product {i} is number {i}." for i in range(1, 30)) + "\n"
    with Stub(alert("CONTRADICTS", "[M1:00:01]")) as stub:
        result = guard.check("The battery will fail.", big)
    check("at most the cited decision and CANDIDATES others are asked about, however long the ledger", len(stub.asked) <= 1 + guard.CANDIDATES and result["guard"] == "dropped", len(stub.asked))

    with Stub(alert(), {"Kinetic": 6.0}) as stub:
        guard.ENABLED = False
        try:
            result = guard.check("My grandmother makes the best pancakes.", LEDGER)
        finally:
            guard.ENABLED = True
    check("with the guard off the auditor is asked about everything and its answer is returned as it is", stub.audited == ["My grandmother makes the best pancakes."] and stub.asked == [] and result["alert"] and result["guard"] == "off", result)


def main() -> None:
    section_tokens()
    section_lexical()
    section_question()
    section_check()
    print(f"All {len(passed)} guard checks passed.")


if __name__ == "__main__":
    main()
