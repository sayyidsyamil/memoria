"""MemoriaBench test: the generator's rules, the validator's teeth, and the freeze.

  - what the generator reads in a decision (facts, hedges, flips) is checked on real AMI sentences,
  - the dataset on disk is exactly what generate_bench.py produces, twice over (a second build from a shuffled history),
  - the validator passes it, and fails, with the right reason, on 20 ways of damaging it,
  - the freeze: written once, then any change to the dataset or its provenance fails until it is renewed,
  - the auditor's memory for a series has the replaced decision gone and "(replaces ...)" on its replacement.

Run: python3.11 test_bench.py   (reads the AMI corpus for the 28 test series once, about a minute)
"""

import copy
import io
import contextlib
import json
import random
import sys
import tempfile
from pathlib import Path

import generate_bench as G
import validate_bench as V

passed: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    assert condition, f"{name}: {detail}"
    passed.append(name)


# ------------------------------------------------------------------ what a decision says

SENTENCES = {
    "The remote will sell for 25 Euro.": {"price": "25"},
    "They will sell the remotes for twenty five Euros each.": {"price": "25"},
    "The production costs cannot exceed 12.50 Euro.": {"cost": "12.50"},
    "The production cost will be twelve Euros and fifty cents.": {"cost": "12.50 exact"},
    "They will aim for a profit of fifty million Euros.": {"profit": "50 million"},
    "The profit aim is fifteen million Euro.": {"profit": "15 million"},
    "The remote will be sold on an international scale.": {"market": "international"},
    "The remote will have international appeal.": {},  # appeal is not a market
    "The team will not work with teletext.": {"teletext": "no"},
    "Teletext is a well known feature of televisions but is no longer in frequent use because of the internet, will not be used.": {"teletext": "no"},
    "The remote will not have an LCD screen.": {"lcd": "no"},
    "No LCD, no voice recognition.": {"lcd": "no", "speech": "no"},
    "The remote will feature an LCD screen.": {"lcd": "yes"},
    "The remote will have buttons that are shown as LCD buttons.": {},  # LCD buttons are not a screen
    "The remote will feature speech recognition.": {"speech": "yes"},
    "It will not use speech recognition.": {"speech": "no"},
    "The remote will use a kinetic battery.": {"power": "kinetic"},
    "The remote will use conventional batteries.": {"power": "regular"},
    "The power source will be batteries because it is cost-effective.": {},  # "batteries" alone says too little
    "The energy source will be a combination of batteries and kinetic energy.": {},
    "The case will be made of rubber.": {"material": "rubber"},
    "The remote will have a latex case.": {"material": "latex"},  # latex is not rubber
    "The materials used will be plastic and rubber.": {"material": "plastic+rubber"},
    "The group decided to use plastic as their casing material instead of metal.": {"material": "plastic"},  # the option turned down is not a fact
    "The case will be double curved.": {"shape": "double"},
    "The remote will use a simple chip.": {"chip": "simple"},
    "The chip needs to be an advanced one to be compatible with the LCD screen.": {"chip": "advanced", "lcd": "yes"},
    "The remote will not use a chip on print.": {},
    "The remote will only be used for televisions.": {"devices": "tv_only"},
    "The remote will be able to control multiple devices.": {"devices": "multi"},
    "Because of budget restrictions, they cannot do speech recognition technologies.": {"speech": "no"},  # restrictions are not "restrict the remote to"
    "The user target group consists of adults age sixty to eighty.": {"target": "elderly"},
    "They will target the 20-40 age group.": {"target": "young"},
    "The corporate image must be recognizable on the remote.": {"corporate": "yes"},
    "The company logo will appear in a brief flash in the boot-up screen of the device.": {},  # not on the remote
    "The remote will be bundled with a docking station to recharge the remote's batteries.": {"dock": "yes"},
    "The remote will have a locator function that responds to clapping.": {"locator": "yes"},
    "The remote will be available in different colour schemes, but not with changeable fronts.": {"covers": "no"},
    "The remote will have push buttons, a locator, and possibly speech recognition if it is still within the budget.": {"locator": "yes"},
    "The group will consider including speech recognition and a locator function in the functional design.": {},  # hedged, and the list item after it too
    "They decided that the product should be bright, trendy, and contain supplement features (possibly mute button, voice recognition).": {},
    "Thus far, LCD and ASR have been ruled out.": {},  # provisional
    "The idea of interchangeable fronts was mentioned again; if it were adopted, the company should be recognisable.": {},
    "Changeable covers for the remote control can link the product to current fashion trends.": {},
}


def fact_checks() -> None:
    for text, wanted in SENTENCES.items():
        found = G.facts_of(text)
        check(f"reads {text[:62]!r}", found == wanted, (found, wanted))


def flip_checks() -> None:
    cases = {
        "The team will not work with teletext.": (("The team will work with teletext.", "working with teletext"), None),
        "The group decided not to include a help button on the device because it would make the remote seem more complicated.": (("We will include a help button on the device.", "including a help button on the device"), None),
        "The remote will not use a chip on print.": (("The remote will use a chip on print.", "using a chip on print"), None),
        "The remote will have a jog dial.": (None, "The remote will not have a jog dial."),
        "The team will also take into account possible usability issues concerning disabled people.": (None, "The team will not take into account possible usability issues concerning disabled people."),
        "The remote is going to be a universal one.": (None, "The remote is not going to be a universal one."),
        "It will be placed at the top of the banana shape.": (None, None),  # "It" is lost without the meeting
        "The design should generally be intuitive without changes that would render it an unfamiliar object to customers.": (None, None),  # already carries a negation
        "The remote will have push buttons outside, and an LCD and spinning wheel inside.": (None, "The remote will not have push buttons outside."),  # its first clause only
        "The remote will be shaped and colored like a banana, and be covered in a spongy material.": (None, None),
        "The buttons will consist of number, a menu button, arrows for changing channel and volume, and a mute button.": (None, None),
        "The group will consider including speech recognition.": (None, None),
    }
    for text, (negation, affirmation) in cases.items():
        check(f"flips {text[:62]!r}", G.negation_flip(text) == negation and G.affirmation_flip(text) == affirmation, (G.negation_flip(text), G.affirmation_flip(text)))
    check("a decision is cut at 'and', never in the middle of a list", G.core("The remote will include games and a simple parental control feature.") == "The remote will include games.")
    check("a reported decision keeps its meaning: 'would' after the subject becomes 'will', a deeper 'would' stays", G.core("It was decided that the remote would feature a screen.") == "The remote will feature a screen."
          and "would" in G.core("The design should generally be intuitive without changes that would render it unfamiliar.").split("changes")[1])


def lexicon_checks() -> None:
    for attr, table in G.ALTERNATIVES.items():
        for value, others in table.items():
            check(f"{attr}={value}: it, and each swap for it, has wording", value in G.LEXICON[attr] and all(o in G.LEXICON[attr] and o != value for o in others), (attr, value, others))
    for attr, values in G.LEXICON.items():
        for value, (variants, replaces, mention) in values.items():
            check(f"{attr}={value}: two one-sentence statements, a note and a pattern", len(variants) == 2 and all(v.endswith(".") and "\n" not in v for v in variants) and replaces and mention, (attr, value))
    check("a money figure is never a replaced value: a made-up history about what the brief fixed", {"price", "cost", "profit", "market"} <= G.NO_SYNTHETIC_OLD)
    check("a cost cap and a cost that merely is the figure are worded differently", G.LEXICON["cost"]["12.50"][0] != G.LEXICON["cost"]["12.50 exact"][0])
    check("a swapped cost is worded as what production will cost, so that it plainly breaks the cap", all("cost" in v and "cannot" not in v for v in G.LEXICON["cost"]["15"][0]))
    check("the five real replaced decisions are the ones listed", sum(len(v) for v in G.REAL_SUPERSESSIONS.values()) == 5)


# ------------------------------------------------------------------ the dataset

def dataset_checks(history: dict) -> tuple[list[dict], list[dict]]:
    rows, provenance = V.read_lines(G.BENCH_FILE), V.read_lines(G.PROVENANCE_FILE)
    built, built_provenance, _, _ = G.build(history)
    check("the dataset on disk is byte for byte what the generator builds", G.serialise(built) == G.BENCH_FILE.read_bytes() and G.serialise(built_provenance) == G.PROVENANCE_FILE.read_bytes())
    again, _, _, _ = G.build({name: history[name] for name in random.Random(1).sample(sorted(history), len(history))})
    check("and the order the series are handed over in does not change it", G.serialise(again) == G.serialise(built))
    check("the file has exactly the six fields, in order, on every row", all(tuple(r) == G.FIELDS for r in rows))
    def framed(r: dict) -> bool:
        return r["statement"].split()[0].rstrip(",") in ("So", "Right", "Okay", "Well") or r["statement"].startswith("I think ")

    overall = sum(framed(r) for r in rows) / len(rows)
    rates = {label: sum(framed(r) for r in rows if r["gold_label"] == label) / 56 for label in G.CLASSES}
    check("a frame word says nothing about the class: each class is framed about as often as all the rows (within 3 standard deviations)", all(abs(v - overall) <= 0.2 for v in rates.values()), (overall, rates))
    check("no statement mentions a meeting, an id or a class name", not any(w in r["statement"].lower() for r in rows for w in ("outdated", "contradict", "es20", "ts30", "is10")))
    return rows, provenance


def validator_checks(rows: list[dict], provenance: list[dict], history: dict) -> None:
    failures, warnings, facts = V.check(rows, provenance, history)
    check("the validator passes the dataset", not failures, failures[:3])
    check("it counts 336 rows, 112 alerts, 224 silent, 112 alerts with valid citations", (facts["rows"], facts["alerts"], facts["silent"], facts["valid_alert_citations"]) == (336, 112, 224, 112), facts)
    check("it says how OUTDATED is founded: 5 real, 51 synthetic", facts["outdated_basis"] == {V.REAL: 5, V.SYNTHETIC: 51}, facts["outdated_basis"])

    def damaged(change) -> list[str]:
        r, p = copy.deepcopy(rows), copy.deepcopy(provenance)
        change(r, p)
        return V.check(r, p, history)[0]

    def first(label: str, series: str | None = None) -> int:
        return next(i for i, r in enumerate(rows) if r["gold_label"] == label and (series is None or r["series_id"] == series))

    ES2009_REAL_OLD = "ES2009b:10:42"
    cases = [
        ("a missing row", lambda r, p: r.pop(5), "Total rows must equal exactly 336"),
        ("a row with another label", lambda r, p: r[first("SUPPORTED_CURRENT")].update(gold_label="CONTRADICTS"), "not exactly 56"),
        ("an alert that is not marked as one", lambda r, p: r[first("OUTDATED")].update(expected_alert=False), "expected_alert is False for OUTDATED"),
        ("a silent row marked as an alert", lambda r, p: r[first("IRRELEVANT")].update(expected_alert=True), "expected_alert is True for IRRELEVANT"),
        ("a contradiction with no citation", lambda r, p: r[first("CONTRADICTS")].update(gold_citation=None), "must cite a decision"),
        ("an update that cites something", lambda r, p: r[first("UPDATES")].update(gold_citation="[ES2002a:07:50]"), "must not cite anything"),
        ("a citation to a moment nobody decided anything", lambda r, p: r[first("CONTRADICTS", "ES2002")].update(gold_citation="[ES2002a:59:59]"), "is not a decision of ES2002"),
        ("a citation to meeting d", lambda r, p: r[first("CONTRADICTS", "ES2002")].update(gold_citation="[ES2002d:01:01]"), "is not [ES2002a-c"),
        ("a citation to another series' decision", lambda r, p: r[first("CONTRADICTS", "ES2002")].update(gold_citation="[ES2004b:24:12]"), "is not [ES2002a-c"),
        ("a citation without brackets", lambda r, p: r[first("CONTRADICTS", "ES2002")].update(gold_citation="ES2002a:07:50"), "is not [ES2002a-c"),
        ("a duplicate id", lambda r, p: r[1].update(id=r[0]["id"]), "duplicate id"),
        ("an id with the wrong class code", lambda r, p: r[first("OUTDATED")].update(id=r[first("OUTDATED")]["id"].replace("-O-", "-C-")), "id does not match"),
        ("a statement repeated within a series", lambda r, p: r[1].update(statement=r[0]["statement"]), "repeats the statement"),
        ("a statement that is not a sentence", lambda r, p: r[3].update(statement="no capital and no stop"), "not a clean single sentence"),
        ("an extra field", lambda r, p: r[0].update(note="x"), "fields are"),
        ("a field of the wrong type", lambda r, p: r[0].update(expected_alert="False"), "wrong type"),
        ("a row the provenance does not describe", lambda r, p: p.pop(), "does not describe exactly"),
        ("an OUTDATED row without its replaces note", lambda r, p: p[first("OUTDATED")].pop("replaces"), "needs a basis"),
        ("an OUTDATED row whose replaced decision is not earlier", lambda r, p: next(x for x in p if x.get("basis") == V.REAL).update(old_decision=next(x for x in p if x.get("basis") == V.REAL)["decision"]), "earlier than"),
        ("a restatement of a decision that a real supersession replaced", lambda r, p: r[first("SUPPORTED_CURRENT", "ES2009")].update(gold_citation=f"[{ES2009_REAL_OLD}]"), "replaced"),
    ]
    for name, change, expected in cases:
        problems = damaged(change)
        check(f"the validator fails on {name}", any(expected in message for message in problems), (expected, problems[:3]))
    check("and an undamaged copy still passes, so none of that was an accident of the copying", not V.check(copy.deepcopy(rows), copy.deepcopy(provenance), history)[0])


def memory_checks(rows: list[dict], provenance: list[dict], history: dict) -> None:
    es2007 = G.memory_for("ES2007", history["ES2007"], rows, provenance)
    check("a real replaced decision is gone from the auditor's memory", "ES2007b:23:43" not in es2007)
    check("and its replacement says what it replaced", "- [ES2007c:28:10] The remote will use a kinetic battery. (replaces regular batteries)" in es2007.splitlines())
    ts3009 = G.memory_for("TS3009", history["TS3009"], rows, provenance)
    check("so does a replaced chip decision in the same meeting", "TS3009c:12:36" not in ts3009 and "(replaces an advanced chip)" in ts3009)
    by_id = {p["id"]: p for p in provenance}
    synthetic = next(r for r in rows if r["gold_label"] == "OUTDATED" and by_id[r["id"]]["basis"] == V.SYNTHETIC)
    memory = G.memory_for(synthetic["series_id"], history[synthetic["series_id"]], rows, provenance)
    line = next(l for l in memory.splitlines() if l.startswith(f"- {synthetic['gold_citation']} "))
    check("a synthetic replacement shows its note on the decision it cites, and that decision is still listed", line.endswith(f"(replaces {by_id[synthetic['id']]['replaces']})"), line)
    check("every other line is the annotators' decision, untouched", all(f"[{d.citation}] {d.text}" in memory for d in history[synthetic["series_id"]] if d.citation not in {x["old_decision"] for x in provenance if x.get("old_decision")}))
    check("replaced decisions are listed in no series' memory", all(f"[{x['old_decision']}]" not in G.memory_for(x["id"].split("-")[0], history[x["id"].split("-")[0]], rows, provenance) for x in provenance if x.get("old_decision")))


def freeze_checks(rows: list[dict], provenance: list[dict]) -> None:
    saved = (V.BENCH_FILE, V.PROVENANCE_FILE, V.HASH_FILE, G.BENCH_FILE, G.HASH_FILE)
    with tempfile.TemporaryDirectory() as scratch:
        folder = Path(scratch)
        V.BENCH_FILE = G.BENCH_FILE = folder / "bench.jsonl"
        V.PROVENANCE_FILE = folder / "prov.jsonl"
        V.HASH_FILE = G.HASH_FILE = folder / "bench.sha256"
        try:
            G.write_lines(V.BENCH_FILE, rows)
            G.write_lines(V.PROVENANCE_FILE, provenance)
            digest, broken = V.freeze(False)
            check("the first run freezes the dataset: one hash for it and one for its provenance", broken is None and len(V.HASH_FILE.read_text().splitlines()) == 2 and digest == V.sha256(V.BENCH_FILE))
            check("a second run agrees", V.freeze(False) == (digest, None))
            before = V.HASH_FILE.read_text()

            changed = copy.deepcopy(rows)
            changed[0]["statement"] = "A different sentence."
            G.write_lines(V.BENCH_FILE, changed)
            _, broken = V.freeze(False)
            check("a changed dataset is refused, by name", broken and "bench.jsonl" in broken and V.HASH_FILE.read_text() == before, broken)
            G.write_lines(V.BENCH_FILE, rows)
            changed_provenance = copy.deepcopy(provenance)
            changed_provenance[0]["method"] = "edited"
            G.write_lines(V.PROVENANCE_FILE, changed_provenance)
            _, broken = V.freeze(False)
            check("so is a changed provenance file", broken and "prov.jsonl" in broken, broken)
            digest2, broken = V.freeze(True)
            check("--refreeze renews the hashes, and then the new files pass", broken is None and V.HASH_FILE.read_text() != before and V.freeze(False) == (digest2, None))

            G.write_lines(V.BENCH_FILE, rows)
            with contextlib.redirect_stderr(io.StringIO()) as err:
                code = G.main([])
            check("the generator will not overwrite a frozen benchmark without --force", code == 1 and "frozen" in err.getvalue() and V.BENCH_FILE.read_bytes() == G.serialise(rows))
        finally:
            V.BENCH_FILE, V.PROVENANCE_FILE, V.HASH_FILE, G.BENCH_FILE, G.HASH_FILE = saved


def main() -> int:
    fact_checks()
    flip_checks()
    lexicon_checks()
    print("[MemoriaBench tests] reading the 28 test series from the AMI corpus (history only)...")
    history = V.corpus_history()
    rows, provenance = dataset_checks(history)
    validator_checks(rows, provenance, history)
    memory_checks(rows, provenance, history)
    freeze_checks(rows, provenance)
    print(f"All {len(passed)} MemoriaBench checks passed: the rules, the dataset, the validator's teeth and the freeze.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
