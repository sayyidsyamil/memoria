"""Test of memoria._parse, the reader of the auditor's reply: the label and the reason are what they were, and the citation is the id the model cited.

No language model is loaded here. The old parser is kept as results/memoria_as_run.py (the exact code behind Table 6.1 and the topic-scoping
runs) and used as an oracle: it must agree with the new one on everything except the citation of a reply whose id is a prefix of another id.

Run: python3.11 test_parse.py
"""

import importlib.util
import random
import re
import sys
from pathlib import Path

import eval_metrics as E
import memoria
import scoping as S

HERE = Path(__file__).resolve().parent
passed: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    assert condition, f"{name}: {detail}"
    passed.append(name)


def load_old():
    spec = importlib.util.spec_from_file_location("memoria_as_run", HERE / "results" / "memoria_as_run.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def memory_text(ids: list[str]) -> str:
    return "".join(f"- [{i}] decision number {n}.\n" for n, i in enumerate(ids))


def hand_checks() -> None:
    ids = ["IS1003c:27:06", "IS1003c:27:06#2", "IS1003c:27:06#3", "M1:08:21"]
    text = memory_text(ids)
    parse = lambda raw: memoria._parse(raw, text)
    check("a reply that cites #3 gets #3 (the bug of the first-substring rule, fixed)", parse("OUTDATED | Titanium replaced by wood | [IS1003c:27:06#3]") == ("OUTDATED", "Titanium replaced by wood", "[IS1003c:27:06#3]"))
    check("and #2 and the plain id", parse("OUTDATED | r | [IS1003c:27:06#2]")[2] == "[IS1003c:27:06#2]" and parse("CONTRADICTS | r | [IS1003c:27:06]")[2] == "[IS1003c:27:06]")
    check("an ordinary citation is unchanged", parse("CONTRADICTS | Exceeds the cap | [M1:08:21]") == ("CONTRADICTS", "Exceeds the cap", "[M1:08:21]"))
    check("an id that does not exist gives an empty citation, and the label and reason are kept", parse("CONTRADICTS | r | [ZZ:1:1]") == ("CONTRADICTS", "r", ""))
    check("an id in brackets beats a longer id mentioned in passing", parse("CONTRADICTS | r | [IS1003c:27:06] versus IS1003c:27:06#3")[2] == "[IS1003c:27:06]")
    check("an id without brackets is found, the longest first", parse("CONTRADICTS | r | see IS1003c:27:06#2 please")[2] == "[IS1003c:27:06#2]")
    check("with several bracketed ids the first that exists is taken, in the order of the reply", parse("CONTRADICTS | r | [NOPE:1:1] [IS1003c:27:06#3] [M1:08:21]")[2] == "[IS1003c:27:06#3]")
    check("a reply with the reason missing still gives the citation", parse("CONTRADICTS | [M1:08:21]")[2] == "[M1:08:21]")
    check("a reply in lower case with dashes is still read", parse("contradicts | r | [M1:08:21]") == ("CONTRADICTS", "r", "[M1:08:21]") and parse("Supported-Current") == ("SUPPORTED_CURRENT", "", ""))
    check("a class without an alert carries no reason and no citation, even if the reply has them", parse("UPDATES | something | [M1:08:21]") == ("UPDATES", "", ""))
    check("an unreadable reply raises no alarm", parse("I do not know") == ("INSUFFICIENT_EVIDENCE", "", "") and parse("") == ("INSUFFICIENT_EVIDENCE", "", ""))
    check("only the first sentence of the reason is kept", parse("OUTDATED | Old one. It was replaced. | [M1:08:21]")[1] == "Old one.")
    check("a citation is empty when memory holds no decision", memoria._parse("CONTRADICTS | r | [M1:08:21]", "")[2] == "")


def property_checks() -> None:
    rng = random.Random(5)
    old = load_old()
    for round_ in range(400):
        n = rng.randint(1, 9)
        base = [f"S{rng.randint(1, 4)}a:{rng.randint(0, 59):02d}:{rng.randint(0, 59):02d}" for _ in range(n)]
        ids = list(dict.fromkeys(base + [f"{b}#{k}" for b in base[: n // 2 + 1] for k in range(2, rng.randint(2, 4))]))
        rng.shuffle(ids)
        text = memory_text(ids)
        cited = rng.choice(ids + ["ZZ:0:0"])
        for raw in (f"CONTRADICTS | reason here. | [{cited}]", f"OUTDATED | reason | [{cited}] and more", f"CONTRADICTS | reason | {cited}", f"CONTRADICTS | [{cited}]", "UPDATES"):
            new = memoria._parse(raw, text)
            was = old._parse(raw, text)
            if new[:2] != was[:2]:
                check("the label and the reason are those of the old parser", False, (raw, new, was))
            if new[2] and new[2].strip("[]") not in ids:
                check("a citation is always the id of a decision that exists", False, (raw, new))
            if new[2] != S.cited_id(raw, ids):
                check("the new parser agrees with the corrected reader of scoping.py", False, (raw, new, S.cited_id(raw, ids)))
            if "#" not in cited and not any(i.startswith(cited + "#") for i in ids) and new[2] != was[2]:
                check("where no id is a prefix of another the citation is what it was", False, (raw, new, was))
    check("on 400 random memories the label and the reason equal the old parser's, a citation is always an existing id, it equals scoping.cited_id, and it is unchanged when no id is a prefix of another", True)


def real_checks() -> None:
    old = load_old()
    rows = [r for r in E.load_predictions(E.RESULTS / "predictions_raw.jsonl") if r["system"] == "M2"]
    text = {p.name.split(".")[0]: p.read_text(encoding="utf-8") for p in (E.RESULTS / "cache" / "memory" / "test").glob("*.versioned.md")}
    new = {r["id"]: memoria._parse(r["raw"], text[r["series_id"]]) for r in rows}
    check("on the 336 replies behind Table 6.1 the labels are the stored ones and the reasons the old parser's", all(new[r["id"]][0] == r["pred"] for r in rows) and all(new[r["id"]][1] == old._parse(r["raw"], text[r["series_id"]])[1] for r in rows))
    differ = sorted(r["id"] for r in rows if new[r["id"]][2] != r["citation"])
    check("the citation differs from the stored one in exactly the three replies the bug had changed", differ == ["IS1003-O-01", "IS1003-O-02", "TS3003-C-01"], differ)
    by = {r["id"]: r for r in rows}
    check("and in those three it is the id the reply cites", all(new[i][2] == re.search(r"\[([^\[\]]+)\]\s*$", by[i]["raw"]).group(0) for i in differ), [(i, new[i][2], by[i]["raw"]) for i in differ])
    alerts = [r for r in rows if r["expected_alert"] and r["alert"]]
    check("103 of the 110 true alerts cite the gold decision now, against 101 as stored", sum(new[r["id"]][2] == r["gold_citation"] for r in alerts) == 103 and sum(r["citation"] == r["gold_citation"] for r in alerts) == 101)
    check("and the new parser equals scoping.cited_id on every one of the 336 replies", all(new[r["id"]][2] == (S.cited_id(r["raw"], [m.group(1) for m in re.finditer(r"^- \[([^\]]+)\]", text[r["series_id"]], re.M)]) if r["alert"] else "") for r in rows))


def main() -> int:
    hand_checks()
    property_checks()
    real_checks()
    print(f"All {len(passed)} parser checks passed: the label and the reason are as before, and the citation is the id the model cited.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
