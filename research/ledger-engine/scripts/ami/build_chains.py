"""Build engine chain files (.chain/.ask) from AMI series + specs.py, and a gold report for spot-checking.

    cd engine && python3.11 scripts/ami/build_chains.py [TEAM ...]     (default: every team in specs.py)

Gold events: the evidence utterance is found through the human summary-to-dialogue-act links; the gold answers to the
questions are derived from the gold events and then cross-checked against the engine's own ledger (oracle run).
"""
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parents[1]
sys.path.insert(0, str(ENGINE))
sys.path.insert(0, str(HERE))

from amilib import ANN, abstract_sentences, linked_times, turns  # noqa: E402
from specs import DATES, NOW, ROLE_NAMES, SPECS  # noqa: E402

OUT = ENGINE / "data" / "ami_v0"
REPORT = ENGINE / "results" / "ami"
ORDER = "abcd"
AS_OF = {"a": "2026-02-05", "b": "2026-02-12", "c": "2026-02-19"}
MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def roles(meeting):
    root = ET.parse(ANN / "corpusResources" / "meetings.xml").getroot()
    for m in root.iter("meeting"):
        if m.get("observation") == meeting:
            return {s.get("nxt_agent"): s.get("role") for s in m.findall("speaker")}
    return {}


def clean(text):
    return re.sub(r"\s+", " ", text.replace("##", " ").replace("|", " ")).strip()


def pretty(iso):
    y, m, d = iso.split("-")
    return f"{MONTHS[int(m)]} {int(d)}, {y}"


def pick_quote(text, rx):
    m = re.search(rx, text, re.I)
    if not m:
        return None
    left = max([text.rfind(c, 0, m.start()) for c in ".?!"] + [-1]) + 1
    right_hits = [i for i in (text.find(c, m.end()) for c in ".?!") if i >= 0]
    right = min(right_hits) + 1 if right_hits else len(text)
    if right - left > 220:
        left, right = max(left, m.start() - 100), min(right, m.end() + 100)
        left = text.find(" ", left) + 1 if left > 0 and text[left - 1] != " " else left
        sp = text.rfind(" ", 0, right)
        right = sp if sp > m.end() else right
    return text[left:right].strip()


def resolve(team, spec, cache, problems):
    """-> {meeting letter: [dict(turn, slot, value, quote, win, sentence)]}"""
    found = {}
    for letter, obj, value, s_no, rx in spec["events"]:
        mid = team + letter
        T, A, L = cache[mid]
        sids = {int(sid.split(".")[-1]): sid for part in A.values() for sid, _ in part}
        sid = sids.get(s_no)
        sentence = next((t for part in A.values() for i, t in part if i == sid), "?")
        links = L.get(sid, [])
        cand = [i for i, (spk, a, b, _) in enumerate(T) for (lspk, ls, le) in links if spk == lspk and a - 1.5 <= le and b + 1.5 >= ls]
        cand = sorted(set(cand))
        pool = [i for i in cand if re.search(rx, T[i][3], re.I)]
        why = "linked utterances"
        if not pool and links:
            lo, hi = min(l[1] for l in links) - 45, max(l[2] for l in links) + 45
            pool = [i for i, t in enumerate(T) if t[2] >= lo and t[1] <= hi and re.search(rx, t[3], re.I)]
            why = "turns within 45 s of the links"
        if not pool:
            stop = set("the a an of to and will be is in for on it that this they remote group have has with as by from at or are was were not".split())
            want = {w for w in re.findall(r"[a-z]+", sentence.lower()) if w not in stop}
            scored = []
            for i, t in enumerate(T):
                if re.search(rx, t[3], re.I):
                    have = set(re.findall(r"[a-z]+", t[3].lower()))
                    scored.append((len(want & have) / (1 + 0.02 * len(have)), -i, i))
            if scored:
                pool = [max(scored)[2]]
                why = "best word overlap in the whole meeting (no usable human link)"
        if not pool:
            problems.append(f"{mid} s{s_no} {obj}={value}: no turn matches /{rx}/ ; sentence: {sentence[:90]} ; links={len(links)} ; first linked: " +
                            " || ".join(T[i][3][:70] for i in cand[:2]))
            continue
        best = max(pool, key=lambda i: (len(re.findall(rx, T[i][3], re.I)), -i))
        quote = pick_quote(T[best][3], rx)
        if not quote or " | " in quote or ' ;; ' in quote or '"' in quote:
            quote = quote.replace('"', "'") if quote else None
        if not quote:
            problems.append(f"{mid} s{s_no} {obj}: could not build a quote")
            continue
        win = (max(0, min(cand + [best]) - 2), max(cand + [best]) + 2) if cand else (best, best)
        found.setdefault(letter, []).append(dict(turn=best, slot=obj, value=value, quote=quote, win=win, sentence=sentence, how=why, spk=T[best][0], links=len(links)))
    return found


def build(team):
    spec = SPECS[team]
    cache = {}
    for letter in ORDER:
        mid = team + letter
        cache[mid] = (turns(mid), abstract_sentences(mid), linked_times(mid))
    problems = []
    events = resolve(team, spec, cache, problems)
    objs = {o[0]: o for o in spec["objects"]}

    def attr(o):
        return "amount:number" if o[3] == "number" else "outcome:enum[" + ",".join(o[3]) + "]" + ("!reverse" if set(o[3]) == {"included", "excluded"} else "")

    # kinds + timeline per slot, in meeting/turn order
    flat = sorted(((ORDER.index(l), e["turn"], l, e) for l, es in events.items() for e in es), key=lambda t: (t[0], t[1]))
    last, timeline = {}, {}
    for _, _, letter, e in flat:
        prev = last.get(e["slot"])
        e["kind"] = "INITIAL" if prev is None else ("CONFIRM" if prev == e["value"] else ("REVERSE" if set(objs[e["slot"]][3]) == {"included", "excluded"} else "REVISE"))
        last[e["slot"]] = e["value"]
        timeline.setdefault(e["slot"], []).append((DATES[letter], e["value"]))

    def state(slot, iso):
        value = None
        for d, v in timeline.get(slot, []):
            if d <= iso:
                value = v
        return value

    people = {}
    lines = [f"chain: {team}", "language: en",
             "note: REAL meetings: AMI Meeting Corpus (CC BY 4.0) scenario series " + team + "a-d, a role-played design team speaking spontaneously. Turns = AMI manual words merged per speaker (gap <= 2 s), turns under 2 words dropped. "
             "Gold = decisions listed in the human DECISIONS abstracts, evidence found through the human summary links; the slot list and allowed values were written by the AI assistant. Meeting dates are assigned (weekly) because AMI has none. Not the product's target domain (corporate board meetings).",
             f"now: {NOW}"]
    meeting_blocks = []
    for letter in ORDER:
        mid = team + letter
        T = cache[mid][0]
        role_of = roles(mid)
        by_turn = {}
        for e in events.get(letter, []):
            by_turn.setdefault(e["turn"], []).append(e)
        body = [f"meeting: {mid} | {DATES[letter]}T09:00:00Z | ingested={DATES[letter]}T12:00:00Z"]
        for i, (spk, a, b, text) in enumerate(T):
            role = role_of.get(spk)
            pid, name = ROLE_NAMES.get(role, (spk.lower(), f"Participant {spk}"))
            people[pid] = name
            text = clean(text)
            line = f"{pid}: {text}"
            if i in by_turn:
                anns = []
                for e in by_turn[i]:
                    q = clean(e["quote"]).replace('"', "'")
                    assert q in text, (mid, q, text)
                    attr_name = "amount" if objs[e["slot"]][3] == "number" else "outcome"
                    anns.append(f'event {e["slot"]}.{attr_name} = {e["value"]} | {e["kind"]} | quote="{q}" | tags=win_{e["win"][0]}_{e["win"][1]}')
                line += "  ## " + " ;; ".join(anns)
            body.append(line)
        meeting_blocks.append(body)
    lines.append("people: " + ", ".join(f"{k}={v}" for k, v in sorted(people.items())))
    for o in spec["objects"]:
        lines.append(f"object: {o[0]} | decision | {o[1]} | {attr(o)}")
    for body in meeting_blocks:
        lines.append("")
        lines += body

    # questions
    qs, asks, n = [], [], 0
    for o in spec["objects"]:
        slot = o[0]
        if slot not in timeline:
            continue
        aname = "amount" if o[3] == "number" else "outcome"
        cur = timeline[slot][-1][1]
        fmt = lambda v: "none" if v is None else (str(v))
        n += 1
        qs.append((f"q{n}", "current", slot, aname, None, cur))
        asks.append((f"q{n}", f"Currently, what has been decided about {o[2]}?"))
        for letter in "abc":
            v = state(slot, AS_OF[letter])
            if v != cur:
                n += 1
                qs.append((f"q{n}", "as_of_valid", slot, aname, AS_OF[letter], v))
                asks.append((f"q{n}", f"What had been decided about {o[2]} as of {pretty(AS_OF[letter])}?"))
                break
        if slot not in spec["skip_changes"]:
            vals = [v for _, v in timeline[slot]]
            changes = sum(1 for a, b in zip(vals, vals[1:]) if a != b)
            n += 1
            qs.append((f"q{n}", "n_changes", slot, aname, None, changes))
            asks.append((f"q{n}", f"How many times has the decision about {o[2]} changed from one value to a different value across the meetings?"))
    lines.append("")
    for qid, typ, slot, aname, valid, gold in qs:
        extra = f" | valid={valid}" if valid else ""
        lines.append(f"question: {qid} | {typ} | {slot}.{aname}{extra} | gold={'none' if gold is None else gold}")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{team}.chain").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (OUT / f"{team}.ask").write_text("# Natural-language wording of each question in %s.chain (template-written by the AI assistant, same author caveat as the chain).\n" % team +
                                      "\n".join(f"{q} | {t}" for q, t in asks) + "\n", encoding="utf-8")

    # gold report for human spot-check
    REPORT.mkdir(parents=True, exist_ok=True)
    rep = [f"# Gold events for AMI {team} ({spec['split']})", "", "| meeting | slot | value | kind | speaker | human summary sentence | evidence quote (verbatim) |", "|---|---|---|---|---|---|---|"]
    for _, _, letter, e in flat:
        rep.append(f"| {team}{letter} | {e['slot']} | {e['value']} | {e['kind']} | {e['spk']} | {e['sentence'][:110]} | {e['quote'][:150]} |")
    if problems:
        rep += ["", "## Unresolved events", *[f"- {p}" for p in problems]]
    (REPORT / f"gold_{team}.md").write_text("\n".join(rep) + "\n", encoding="utf-8")
    return problems, len(flat), len(qs), sum(len(cache[team + l][0]) for l in ORDER)


if __name__ == "__main__":
    teams = sys.argv[1:] or list(SPECS)
    for t in teams:
        problems, ne, nq, nt = build(t)
        print(f"{t}: {ne} gold events, {nq} questions, {nt} turns, {len(problems)} unresolved")
        for p in problems:
            print("   !", p)
