"""Build the demo files from series.py and check them against the engine's own oracle.

    cd engine && python3.11 scripts/demo/make_demo.py

Writes data/demo/: registry.json, meeting_1..3.md (the note format the app's live transcript panel saves),
demo.chain + demo.ask (engine evaluation format, with gold), answer_key.md (for the UAT facilitator).
"""
import json
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parents[1]
sys.path.insert(0, str(ENGINE))
sys.path.insert(0, str(HERE))

from series import MEETINGS, OBJECTS, PEOPLE, QUESTIONS  # noqa: E402
from memoria_engine.evaluation.dataset import parse_ask, parse_chain  # noqa: E402
from memoria_engine.evaluation.oracle import ledger_answer, values_equal  # noqa: E402
from memoria_engine.evaluation.run_eval import run_pipeline  # noqa: E402
from memoria_engine.extractors import OracleExtractor  # noqa: E402
from memoria_engine.service import registry_to_json  # noqa: E402

OUT = ENGINE / "data" / "demo"
NOW = "2026-10-14T00:00:00Z"
WORDS_PER_SECOND, PAUSE = 2.6, 0.7


def clock(seconds):
    s = max(0, int(seconds))
    return f"{s // 60}:{s % 60:02d}"


def pretty(date, hhmm):
    return datetime.strptime(f"{date} {hhmm}", "%Y-%m-%d %H:%M").strftime("%d %b %Y, %H:%M")


def timeline(turns, index):
    """Turn start times and total length: exact from the synthesised audio when it exists, otherwise estimated from word counts."""
    rttm = OUT / "audio" / f"meeting_{index}.rttm"
    if rttm.exists():
        rows = [line.split() for line in rttm.read_text().splitlines() if line.strip()]
        starts = [round(float(r[3]), 1) for r in rows]
        return starts, float(rows[-1][3]) + float(rows[-1][4])
    t, out = 0.0, []
    for _, text, _ in turns:
        out.append(round(t, 1))
        t += len(text.split()) / WORDS_PER_SECOND + PAUSE
    return out, t


def chain_text():
    lines = ["chain: demo", "language: en",
             "note: FICTIONAL demo series (invented people, vendors and numbers), authored by the AI assistant and the project author. Used for system tests, the demo and user acceptance testing. Not real meetings.",
             f"now: {NOW}", "people: " + ", ".join(f"{k}={v}" for k, v in PEOPLE.items()), *OBJECTS, ""]
    for m in MEETINGS:
        start = datetime.strptime(f"{m['date']} {m['clock']}", "%Y-%m-%d %H:%M")
        lines.append(f"meeting: {m['id']} | {start:%Y-%m-%dT%H:%M:%SZ} | ingested={start + timedelta(hours=3):%Y-%m-%dT%H:%M:%SZ}")
        for spk, text, ann in m["turns"]:
            lines.append(f"{spk}: {text}" + (f"  ## {ann}" if ann else ""))
        lines.append("")
    for qid, kind, slot, extra, gold, _ in QUESTIONS:
        lines.append(f"question: {qid} | {kind} | {slot} | " + (extra + " | " if extra else "") + f"gold={gold}")
    return "\n".join(lines) + "\n"


def ask_text():
    return "# Natural-language wording of each question in demo.chain (authored by the AI assistant).\n" + "".join(f"{q[0]} | {q[5]}\n" for q in QUESTIONS)


def note_text(m, index):
    offsets, total = timeline(m["turns"], index)
    names = []
    for spk, _, _ in m["turns"]:
        if PEOPLE[spk] not in names:
            names.append(PEOPLE[spk])
    body, last = "", None
    for (spk, text, _), t0 in zip(m["turns"], offsets):
        if spk != last:
            body += f"\n**{PEOPLE[spk]}** · {clock(t0)}\n{text}\n"
            last = spk
        else:
            body += f"{text}\n"
    return "\n".join(["---", "type: Transcript", f"date: {m['date']}", "---", f"# {m['title']}", "",
                      f"> {pretty(m['date'], m['clock'])}  ·  {clock(total)}  ·  {', '.join(names)}", "",
                      "## Summary", "", "_Add a summary…_", "", "## Action items", "", "- [ ] ", "", "## Transcript", body])


def answer_key(chain):
    rows = []
    for (qid, kind, slot, extra, gold, text), q in zip(QUESTIONS, chain.questions):
        shown = PEOPLE.get(gold, gold)
        rows.append(f"| {qid} | {kind.replace('_', ' ')} | {text} | {shown} |")
    events = []
    for gm in chain.meetings:
        for e in gm.events:
            events.append(f"| {gm.meeting.meeting_id} | turn {e.turn + 1} | {e.object_id}.{e.attribute} | {PEOPLE.get(e.value, e.value)} | {e.kind} | \"{e.quote}\" |")
    return "\n".join(["# Demo series answer key (fictional)", "",
                      "Three meetings of the \"Digital Procurement Pilot\" steering committee: 14 Sep, 28 Sep, 12 Oct 2026. Speakers: Aisha (chair), Raj (finance), Wei Ling (IT). All names, vendors and numbers are invented.", "",
                      "## What really happened (gold events)", "", "| Meeting | Where | Item | Value | Kind | Evidence quote |", "|---|---|---|---|---|---|", *events, "",
                      "## Questions and correct answers", "", "| ID | Type | Question | Correct answer |", "|---|---|---|---|", *rows, "",
                      "Things that must NOT be recorded as decisions (distractors): Gamma Soft being dropped (opinion), the 300,000 ringgit draft, the outside consultant, a second pilot team in Penang, a mobile app, Raj covering training, the lessons-learned session.", ""])


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    text = chain_text()
    chain = parse_ask(ask_text(), parse_chain(text, "demo.chain"), "demo.ask")
    run = run_pipeline(chain, OracleExtractor(chain), "immediate")
    pipe, bad = run["pipeline"], []
    for q in chain.questions:
        got = ledger_answer(pipe.ledger, q, chain.now)
        if not values_equal(got, q.gold):
            bad.append((q.qid, got, q.gold))
    if bad:
        sys.exit(f"gold answers disagree with the oracle ledger: {bad}")
    assert pipe.ledger.check_invariants() == []
    (OUT / "demo.chain").write_text(text)
    (OUT / "demo.ask").write_text(ask_text())
    (OUT / "registry.json").write_text(json.dumps(registry_to_json(chain.registry), indent=2) + "\n")
    for i, m in enumerate(MEETINGS, 1):
        (OUT / f"meeting_{i}.md").write_text(note_text(m, i))
    (OUT / "answer_key.md").write_text(answer_key(chain))
    n_events = sum(len(gm.events) for gm in chain.meetings)
    words = [sum(len(t.split()) for _, t, _ in m["turns"]) for m in MEETINGS]
    print(f"ok: {len(chain.meetings)} meetings, {n_events} gold events, {len(chain.questions)} questions, oracle agrees on all; words per meeting {words}")


if __name__ == "__main__":
    main()
