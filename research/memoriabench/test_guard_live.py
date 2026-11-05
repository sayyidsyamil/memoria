"""Guard test with the real model: does the guard let real conflicts through, and stop what is not one?

The statements are written against four decisions (a temporary file: nothing of the person's own is touched). The ones that must alert are
conflicts said in everyday words, some without naming the product; the ones that must not are the kind of sentence that used to raise a
false alarm: look-alikes that share a word, a number or a date with a decision but are about something else, and sentences that are
about nothing here at all. Each case here was run when the guard was built; the model is deterministic, so a failure is a regression.

Run: python3.11 test_guard_live.py
"""

import tempfile
import time
from pathlib import Path

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

MUST_ALERT = [
    ("We're still using standard batteries.", "[M3:14:02]"),
    ("Each one will cost sixteen euros to produce.", "[M1:08:21]"),
    ("Let's use hard plastic for the case.", "[M2:22:15]"),
    ("The target market is Asia.", "[M3:30:10]"),
    ("We will ship in the first quarter.", "[M3:30:10]"),
    ("We're replacing kinetic charging with plain batteries.", "[M3:14:02]"),
    ("Marketing wants the launch in the first quarter.", "[M3:30:10]"),
]

MUST_NOT_ALERT = [
    # about something else, but with words in common with a decision
    "My laptop battery only lasts three hours these days.",
    "They replaced the battery in my car yesterday.",
    "The camera I want costs fourteen hundred euros.",
    "Coffee in this city costs about three euros.",
    "My rent is twelve hundred euros a month.",
    "We are going to Europe for our honeymoon in the fourth quarter.",
    "The drone uses a kinetic energy recovery system to save power.",
    # about the project, and not a conflict: history, and a question
    "We used to use the standard battery before we switched to kinetic charging.",
    "The old design had a standard battery, which is why we changed it.",
    "Should we move the launch to the second quarter?",
    # about nothing here
    "My grandmother makes the best pancakes.",
    "Does anyone want coffee?",
    "That match last night was incredible.",
    # about a decision, and not against it
    "Kinetic charging is confirmed for the remote.",
    "Unit cost is eleven euros, below the cap.",
    "The case is rubberized plastic, as agreed.",
    "We are on track for a Q4 launch in Europe.",
]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="guard_live_") as directory:
        path = Path(directory) / "decisions.md"
        path.write_text(LEDGER, encoding="utf-8")
        args = {"decisions_file": str(path)}
        memoria.check_statement("warm up", **args)  # the model loads here: that is not what is timed
        guard.confirm("warm up", "Cost is low.")

        slowest = 0.0
        for statement, citation in MUST_ALERT:
            started = time.perf_counter()
            result = guard.check(statement, LEDGER, **args)
            slowest = max(slowest, time.perf_counter() - started)
            check(f"a real conflict is an alert that cites its decision: {statement}", result["alert"] and result["citation"] == citation, result)
        check("an alert, confirmed, takes well under three seconds", slowest < 3.0, slowest)

        for statement in MUST_NOT_ALERT:
            result = guard.check(statement, LEDGER, **args)
            check(f"no alert: {statement}", not result["alert"], result)

        started = time.perf_counter()
        unrelated = guard.check("My grandmother makes the best pancakes.", LEDGER, **args)
        check("a sentence about no decision does not even reach the model: it is answered in a few milliseconds", unrelated["guard"] == "unrelated" and time.perf_counter() - started < 0.05)

        raw = [memoria.check_statement(statement, **args)["alert"] for statement in MUST_NOT_ALERT[:3]]
        check("these look-alikes are alerts when the auditor is asked alone, so it is the guard that stops them", all(raw), raw)
    print(f"All {len(passed)} real-model guard checks passed.")


if __name__ == "__main__":
    main()
