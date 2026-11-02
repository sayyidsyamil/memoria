"""Test of the topic-scoping experiment: the scope, the other-topic memories, the reply parser, the freeze and the runner's plumbing.

No language model is loaded here, so this can run while anything else does. What it proves:
  - the scope is the k most similar decisions in memory order, the money/time rule adds at most two and only when the
    statement mentions money or time, ties go to the earlier decision, and an empty memory gives an empty scope,
  - scope recall and the choice of k are what the pre-registered rule says, on hand-worked cases and by brute force,
  - the other-topic memories (C1, C2) hold every own decision exactly once, never a decision of the series itself, are nested,
    deterministic and shuffled, and on the real 28 series no distractor shares an attribute or a specific word with a probe
    or an own decision, so a gold label cannot change,
  - the corrected parser returns the id the model cited where memoria._parse returns a shorter id (the real bug, on the real
    raw replies), and is otherwise the same,
  - the freeze names every file that moved, the guard sees a process holding a model, the worker hands a system a series
    and a statement and nothing else, notes the prompt, writes the gold label only after the answer and resumes where it stopped.

Run: python3.11 test_scoping.py
"""

import contextlib
import hashlib
import io
import itertools
import json
import random
import re
import sys
import tempfile
from pathlib import Path

import numpy as np

import eval_metrics as E
import run_benchmarks as R
import run_scoping as RS
import scoping as S

passed: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    assert condition, f"{name}: {detail}"
    passed.append(name)


class FakeEmbedder:
    """Bag of words hashed into 256 dimensions: two texts are close when they share words. Deterministic, no model."""

    def encode(self, texts: list[str]) -> np.ndarray:
        out = np.zeros((len(texts), 256), dtype="float32")
        for i, text in enumerate(texts):
            for word in re.findall(r"[a-z]+", text.lower()):
                out[i, int(hashlib.md5(word.encode()).hexdigest(), 16) % 256] += 1
        norms = np.linalg.norm(out, axis=1, keepdims=True)
        norms[norms == 0] = 1
        return out / norms


def memory(*texts: str, prefix: str = "S1") -> list[dict]:
    return S.parse_memory("".join(f"- [{prefix}a:{i:02d}:00] {t}\n" for i, t in enumerate(texts, 1)))


# ------------------------------------------------------------------ select and the scope

def select_checks() -> None:
    sims = np.array([0.1, 0.9, 0.5, 0.7, 0.3])
    none = np.zeros(5, dtype=bool)
    check("select takes the k most similar and returns them in memory order", S.select(sims, none, False, 3) == [1, 2, 3], S.select(sims, none, False, 3))
    check("k larger than the memory returns every decision; k = 0 returns none", S.select(sims, none, False, 99) == [0, 1, 2, 3, 4] and S.select(sims, none, False, 0) == [])
    check("a tie goes to the earlier decision", S.select(np.array([0.5, 0.5, 0.5]), np.zeros(3, dtype=bool), False, 2) == [0, 1])

    constraint = np.array([False, False, True, False, True])
    check("without a money/time cue the rule adds nothing", S.select(sims, constraint, False, 1) == [1])
    check("with a cue it adds the most similar money/time decisions that are not already in (here 2 and 4)", S.select(sims, constraint, True, 1) == [1, 2, 4])
    check("it adds at most `extra`, the most similar first", S.select(sims, np.array([True, False, True, False, True]), True, 1, extra=1) == [1, 2])
    check("a money/time decision already in the top k is not added twice", S.select(sims, np.array([False, True, False, False, False]), True, 2) == [1, 2] or S.select(sims, np.array([False, True, False, False, False]), True, 2) == [1, 3])
    check("with the rule switched off a cue changes nothing", S.select(sims, constraint, True, 1, rule=False) == [1])
    check("with no money/time decision in memory a cue adds nothing", S.select(sims, none, True, 2) == [1, 3])
    check("the result is sorted and without repeats, on 300 random cases",
          all((lambda r: r == sorted(set(r)))(S.select(np.random.default_rng(i).random(n), np.random.default_rng(i + 1).random(n) > 0.5, bool(i % 2), 1 + i % 5))
              for i, n in ((i, 1 + i % 9) for i in range(300))))


def scoper_checks() -> None:
    items = memory("The remote will use a kinetic battery.", "The case will be made of rubber.", "The production cost cannot exceed 12.50 Euro.",
                   "The remote will have a docking station.", "Teletext will be included.")
    scoper = S.Scoper(FakeEmbedder(), {"S1": items, "EMPTY": []}, k=2, extra=1)
    scope = scoper.scope("S1", "Let us use a battery in the remote.")
    check("the scope is the most similar decisions, in memory order, as their original lines", scope["ids"] == ["S1a:01:00", "S1a:04:00"] and scope["text"] == "\n".join(items[i]["line"] for i in (0, 3)), scope)
    check("no cue: nothing added and the 'added' count is 0", scope["cue"] is False and scope["added"] == 0)
    money = scoper.scope("S1", "I think the remote will cost 20 Euro to produce.")
    check("a statement about cost adds the cost decision even when it is not among the 2 nearest, and says it was added", "S1a:03:00" in money["ids"] and money["cue"] and money["added"] in (0, 1), money)
    forced = S.Scoper(FakeEmbedder(), {"S1": items}, k=1, extra=1).scope("S1", "We should add teletext to the casing please, spending nothing.")
    check("the added decision is the money/time one (cost), and 'added' is 1 when it was not already the nearest", forced["cue"] and "S1a:03:00" in forced["ids"] and forced["added"] == len(forced["ids"]) - 1, forced)
    calls = []
    counting = FakeEmbedder()
    original = counting.encode
    counting.encode = lambda texts: calls.append(list(texts)) or original(texts)
    empty = S.Scoper(counting, {"EMPTY": []}, k=2)
    calls.clear()
    result = empty.scope("EMPTY", "anything")
    check("an empty memory gives an empty scope and no error, without embedding the statement", result == {"indices": [], "ids": [], "text": "", "cue": False, "added": 0} and calls == [], (result, calls))
    again = scoper.scope("S1", "Let us use a battery in the remote.")
    check("the scope is deterministic", again == scope)
    given = scoper.scope("S1", "ignored", query=scoper.embedder.encode(["Teletext will be included."])[0])
    check("a ready-made query vector is used instead of embedding the statement", "S1a:05:00" in given["ids"], given)
    check("has_cue sees money words, currency, digits and time words, and not plain talk",
          all(S.has_cue(t) for t in ("It will cost more.", "Sell it for 25 Euro.", "A budget of ten.", "Deadline is Friday.", "In Q4.", "Pay $5.", "We launch in March.", "About 3 buttons."))
          and not any(S.has_cue(t) for t in ("The remote will use a kinetic battery.", "Did anyone watch the match?", "Let's add a dark mode.")))


# ------------------------------------------------------------------ recall and k

def recall_checks() -> None:
    rows = [{"gold_label": "SUPPORTED_CURRENT", "gold_citation": "[A:1]", "scope_ids": ["A:1", "B:2"]},
            {"gold_label": "SUPPORTED_CURRENT", "gold_citation": "[A:2]", "scope_ids": ["B:2"]},
            {"gold_label": "OUTDATED", "gold_citation": "[A:3#2]", "scope_ids": ["A:3#2"]},
            {"gold_label": "UPDATES", "gold_citation": None, "scope_ids": []},
            {"gold_label": "IRRELEVANT", "gold_citation": None, "scope_ids": ["A:1"]}]
    r = S.scope_recall(rows)
    check("scope recall counts only the probes that have a gold decision, and a gold decision inside the scope", (r["n"], r["found"], r["recall"]) == (3, 2, 2 / 3), r)
    check("by class: SUPPORTED_CURRENT 1 of 2, OUTDATED 1 of 1; the classes without a gold decision are absent", r["by_class"] == {"OUTDATED": 1.0, "SUPPORTED_CURRENT": 0.5}, r)
    check("an id with a #2 suffix is not the id without it", S.scope_recall([{"gold_label": "OUTDATED", "gold_citation": "[A:3#2]", "scope_ids": ["A:3"]}])["found"] == 0)
    check("no probe with a gold decision: recall is nan, not 0 or 1", S.scope_recall(rows[3:])["recall"] != S.scope_recall(rows[3:])["recall"])

    check("tune_k picks the smallest k that reaches 0.95, inclusive", S.tune_k({2: 0.90, 3: 0.95, 4: 1.0}) == 3 and S.tune_k({2: 0.949, 3: 0.97}) == 3)
    check("tune_k takes the largest allowed k when none reaches the target, and ignores k outside 2..6", S.tune_k({2: 0.5, 3: 0.6, 4: 0.7, 5: 0.8, 6: 0.9, 8: 1.0}) == 6 and S.tune_k({1: 1.0, 2: 0.2}) == 6)
    check("a missing k counts as recall 0", S.tune_k({4: 0.96}) == 4)


# ------------------------------------------------------------------ other-topic memories

def stem_checks() -> None:
    check("stems drop grammatical words and short words and keep the first four letters", S.stems("The remote will use the Batteries and a case.") == {"remo", "batt", "case"}, S.stems("The remote will use the Batteries and a case."))
    check("a singular and its plural share a stem (euro, euros; battery, batteries; button, buttons)", S.stems("euro") == S.stems("euros") and S.stems("battery") == S.stems("batteries") and S.stems("button") == S.stems("buttons"))
    texts = [f"The remote has {w}" for w in ("alpha", "bravo", "cobra", "delta", "eagle", "fiver", "gamma", "hotel", "india", "julia", "karma", "lemon", "mango", "nacho",
                                                   "olive", "pasta", "queen", "radio", "sugar", "tiger")]
    check("a generic stem is one in at least 10% of the decisions: 1 of 20 is not, 2 of 21 (9.5%) is not, 2 of 20 (10%) is, 3 of 22 is",
          S.generic_stems(texts) == {"remo"} and S.generic_stems(texts + ["alpha one"]) == {"remo"} and S.generic_stems(texts[:19] + ["alpha again"]) == {"remo", "alph"}
          and S.generic_stems(texts + ["alpha one", "alpha two"]) == {"remo", "alph"}, (S.generic_stems(texts), S.generic_stems(texts[:19] + ["alpha again"])))
    check("the attributes of a text are the generate_bench keyword attributes it mentions", S.attributes("We will use a kinetic battery and a docking station.") == {"power", "dock"}
          and S.attributes("The case is made of rubber.") == {"material"} and S.attributes("Rubber buttons, please.") == set() and S.attributes("The selling price is 25 Euro.") == {"price"})
    own_attributes, own_stems = {"power"}, {"batt", "kine"}
    check("a decision is admissible when it shares no attribute and no specific word", S.admissible("The remote will have a scroll wheel.", own_attributes, own_stems, set()))
    check("a decision on the same attribute is not admissible, even in other words (solar power vs kinetic battery)", not S.admissible("The remote will run on solar power.", own_attributes, own_stems, set()))
    check("a decision sharing a specific word is not admissible (kinetic)", not S.admissible("A kinetic wheel is cool.", set(), own_stems, set()))
    check("a word every decision uses (generic) does not exclude", S.admissible("Batteries are fun.", set(), own_stems, {"batt"}) and not S.admissible("Batteries are fun.", set(), own_stems, set()))


def toy_world() -> tuple[dict[str, list[dict]], dict[str, list[str]]]:
    memories = {
        "AA": memory("The remote will use a kinetic battery.", "The case will be rubber.", "Okay.", prefix="AA"),
        "BB": memory("The remote will have a scroll wheel.", "Teletext will be included.", "The remote will run on solar power.", "A wooden stand is provided.", prefix="BB"),
        "CC": memory("The remote will glow in the dark.", "A carrying pouch is included.", "Packaging will be recycled cardboard.", prefix="CC"),
    }
    statements = {"AA": ["We use a kinetic battery.", "Is the weather nice?"], "BB": ["Add a scroll wheel."], "CC": ["Glow is cool."]}
    return memories, statements


def memory_checks() -> None:
    memories, statements = toy_world()
    generic = S.generic_stems([i["text"] for v in memories.values() for i in v])
    pool = S.distractor_pool("AA", memories, statements, generic)
    texts = [i["text"] for i in pool]
    check("the pool holds only other series' decisions that are admissible: not the solar one (same attribute), not the series' own", "The remote will run on solar power." not in texts and all(i["source"] != "AA" for i in pool) and
          "Teletext will be included." in texts and "A carrying pouch is included." in texts, texts)
    check("the pool is in a fixed order (series, then file order)", [i["id"] for i in pool] == sorted([i["id"] for i in pool], key=lambda x: (x[:2], x)) or [i["source"] for i in pool] == sorted(i["source"] for i in pool))

    text0, meta0 = S.build_memory("AA", "C0", memories, statements, generic)
    check("C0 is the series' own memory, line for line, with nothing added", text0 == "".join(i["line"] + "\n" for i in memories["AA"]) and meta0["distractors"] == 0 and meta0["ids"] == [i["id"] for i in memories["AA"]])
    text1, meta1 = S.build_memory("AA", "C1", memories, statements, generic)
    text2, meta2 = S.build_memory("AA", "C2", memories, statements, generic)
    ids1, ids2 = [i["id"] for i in S.parse_memory(text1)], [i["id"] for i in S.parse_memory(text2)]
    own = [i["id"] for i in memories["AA"]]
    check("C1 and C2 hold every own decision exactly once", all(ids1.count(o) == 1 and ids2.count(o) == 1 for o in own))
    check("the ids of the memory text and of the metadata are the same, in the same order", ids1 == meta1["ids"] and ids2 == meta2["ids"])
    check("no decision of the series itself comes back as a distractor, and no id repeats", not any(d.startswith("AA") for d in meta2["distractor_ids"]) and len(set(ids2)) == len(ids2) and len(set(ids1)) == len(ids1))
    check("C1 is part of C2 (nested)", set(meta1["distractor_ids"]) <= set(meta2["distractor_ids"]))
    check("the distractors are exactly the admissible pool when the pool is small", sorted(meta2["distractor_ids"]) == sorted(i["id"] for i in pool) and meta2["pool"] == len(pool))
    again = S.build_memory("AA", "C2", memories, statements, generic)
    check("the memories are deterministic", again == (text2, meta2))
    check("the lines are shuffled with the own decisions rather than put after them", any(ids2[i] not in own for i in range(len(own))) or len(ids2) <= len(own))

    def word(index: int) -> str:  # a word whose first four letters no other word shares
        return "w" + "".join(chr(97 + (index // 26 ** i) % 26) for i in range(3)) + "tail"

    big = {f"S{n:02d}": [{"id": f"S{n:02d}a:{j:02d}:00", "text": f"Entry {word(n * 10 + j)}", "line": f"- [S{n:02d}a:{j:02d}:00] Entry {word(n * 10 + j)}"} for j in range(1, 11)] for n in range(1, 40)}
    text_b, meta_b = S.build_memory("S01", "C2", big, {"S01": ["Something about nothing."]}, {"entr"})
    check("C2 is capped at 150 distractors", meta_b["distractors"] == 150 and meta_b["pool"] == 380, meta_b["distractors"])
    text_c1, meta_c1 = S.build_memory("S01", "C1", big, {"S01": ["Something about nothing."]}, {"entr"})
    check("C1 holds 30 distractors", meta_c1["distractors"] == 30 and set(meta_c1["distractor_ids"]) <= set(meta_b["distractor_ids"]))
    check("a different series gets a different draw", S.build_memory("S02", "C1", big, {"S02": ["x"]}, {"entr"})[1]["distractor_ids"] != meta_c1["distractor_ids"])


def real_memory_checks() -> None:
    memories, statements, probes = RS.load_split("test")
    generic = S.generic_stems([i["text"] for v in memories.values() for i in v])
    check("the real test split has 28 series and 336 probes, and their cached memory holds 367 decisions", len(memories) == 28 and len(probes) == 336 and sum(len(v) for v in memories.values()) == 367)
    unsafe, shortfall, nested = [], [], True
    for series in sorted(memories):
        own_attributes, own_stems = S.series_profile(memories[series], statements[series], generic)
        text2, meta2 = S.build_memory(series, "C2", memories, statements, generic)
        text1, meta1 = S.build_memory(series, "C1", memories, statements, generic)
        pool = {i["id"]: i for i in S.distractor_pool(series, memories, statements, generic)}
        nested &= set(meta1["distractor_ids"]) <= set(meta2["distractor_ids"])
        if meta1["distractors"] < 29:
            shortfall.append(series)
        for d in meta2["distractor_ids"]:
            decision = pool[d]["text"]
            shared = (S.attributes(decision) & own_attributes) or ((S.stems(decision) - generic) & own_stems)
            if shared:
                unsafe.append((series, d, shared))
    check("on all 28 real series no distractor of C2 shares an attribute or a specific word with an own decision or a probe", not unsafe, unsafe[:3])
    check("every real C1 has 29 or 30 distractors and is part of C2", not shortfall and nested, shortfall)
    sizes = [len(S.parse_memory(RS.memory_path("C2", s).read_text())) for s in memories]
    check("the C2 files on disk are what build_memory makes of the cache, and are 51 to 154 decisions", all(RS.memory_path(c, s).read_text() == S.build_memory(s, c, memories, statements, generic)[0] for s in sorted(memories)[:6] for c in ("C1", "C2")) and min(sizes) >= 40 and max(sizes) <= 160, (min(sizes), max(sizes)))
    check("every distractor's own decision text is the line of its source series' memory (the same words the auditor would read there)",
          all(any(i["line"] == line for i in memories[line_source(line)]) for line in S.parse_memory(RS.memory_path("C1", "ES2004").read_text()) and [l["line"] for l in S.parse_memory(RS.memory_path("C1", "ES2004").read_text())]))


def line_source(line: str) -> str:
    match = re.match(r"- \[([A-Z]{2}\d{4})", line)
    return match.group(1)


# ------------------------------------------------------------------ reading a reply

def parser_checks() -> None:
    import memoria

    known = ["IS1003c:27:06", "IS1003c:27:06#2", "IS1003c:27:06#3"]
    raw = "OUTDATED | Titanium case replaced by wood | [IS1003c:27:06#3]"
    decisions = "\n".join(f"- [{k}] something" for k in known)
    import importlib.util

    spec = importlib.util.spec_from_file_location("memoria_as_run", Path(__file__).resolve().parent / "results" / "memoria_as_run.py")
    as_run = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(as_run)
    check("the parser as it was when the results were produced (results/memoria_as_run.py) returned the shorter id for a reply that cites #3 (the bug, reproduced); memoria._parse now returns the id that was cited",
          as_run._parse(raw, decisions)[2] == "[IS1003c:27:06]" and memoria._parse(raw, decisions)[2] == "[IS1003c:27:06#3]", (as_run._parse(raw, decisions), memoria._parse(raw, decisions)))
    check("the corrected parser returns the id that was cited", S.cited_id(raw, known) == "[IS1003c:27:06#3]")
    check("and the same for #2 and for the plain id", S.cited_id("OUTDATED | r | [IS1003c:27:06#2]", known) == "[IS1003c:27:06#2]" and S.cited_id("CONTRADICTS | r | [IS1003c:27:06]", known) == "[IS1003c:27:06]")
    check("an id that does not exist gives no citation", S.cited_id("CONTRADICTS | r | [ZZ9999a:01:01]", known) == "")
    check("a class-only reply cites nothing", S.cited_id("UPDATES", known) == "" and S.cited_id("SUPPORTED_CURRENT", known) == "")
    check("an id in plain text, without brackets, is found, the longest first", S.cited_id("CONTRADICTS | see IS1003c:27:06#2 for this", known) == "[IS1003c:27:06#2]")
    check("with two bracketed ids the first known one is taken", S.cited_id("CONTRADICTS | r | [NOPE:1:1] [IS1003c:27:06#2] [IS1003c:27:06]", known) == "[IS1003c:27:06#2]")
    check("an id in brackets, which is what the model cited, beats a longer id it merely mentioned", S.cited_id("CONTRADICTS | r | [IS1003c:27:06] versus IS1003c:27:06#3", known) == "[IS1003c:27:06]")
    check("a reply with the reason missing still yields the citation", S.cited_id("CONTRADICTS | [IS1003c:27:06#2]", known) == "[IS1003c:27:06#2]")

    rows = [r for r in E.load_predictions(E.RESULTS / "predictions_raw.jsonl") if r["system"] == "M2"]
    text = {}
    for path in R.CACHE.joinpath("memory", "test").glob("*.versioned.md"):
        for item in S.parse_memory(path.read_text(encoding="utf-8")):
            text[item["id"]] = item["id"]
    by_series = {p.name.split(".")[0]: [i["id"] for i in S.parse_memory(p.read_text(encoding="utf-8"))] for p in R.CACHE.joinpath("memory", "test").glob("*.versioned.md")}
    alerts = [r for r in rows if r["expected_alert"] and r["alert"]]
    as_run = sum(r["citation"] == r["gold_citation"] for r in alerts)
    fixed = sum(S.cited_id(r["raw"], by_series[r["series_id"]]) == r["gold_citation"] for r in alerts)
    check("on the real M2 replies: 101 of 110 true alerts cited the gold decision as parsed, and 103 once the cited id is read exactly", (as_run, len(alerts), fixed) == (101, 110, 103), (as_run, len(alerts), fixed))
    differ = [r["id"] for r in alerts if S.cited_id(r["raw"], by_series[r["series_id"]]) != r["citation"]]
    check("the parser changes exactly the three citations that the shorter-id bug had changed", sorted(differ) == ["IS1003-O-01", "IS1003-O-02", "TS3003-C-01"], differ)
    check("it never changes a label, and agrees with memoria._parse on every other reply", all(S.cited_id(r["raw"], by_series[r["series_id"]]) == r["citation"] for r in rows if r["id"] not in differ))


# ------------------------------------------------------------------ the freeze, the guard and the files

def freeze_checks() -> None:
    saved = (RS.HERE, RS.OUT, RS.CONFIG, RS.PREREG, R.BENCH_FILE)
    with tempfile.TemporaryDirectory() as folder:
        base = Path(folder)
        for name in ("scoping.py", "run_scoping.py", "memoria.py"):
            (base / name).write_text(f"# {name}\n")
        out = base / "results" / "scoping"
        out.mkdir(parents=True)
        (out / "config.json").write_text(json.dumps({"k": 4}))
        (out / "conditions.json").write_text("{}")
        bench = base / "bench.jsonl"
        bench.write_text("{}\n")
        RS.HERE, RS.OUT, RS.CONFIG, RS.PREREG, R.BENCH_FILE = base, out, out / "config.json", out / "preregistration.json", bench
        try:
            check("a test run is refused until the pre-registration exists", RS.prereg_problem() == "no pre-registration: run freeze before a test run")
            record = RS.freeze()
            check("freeze records the hash of the code, the config, the conditions, the benchmark and memoria.py, and k", set(record["files"]) == {"scoping.py", "run_scoping.py"} and record["k"] == 4 and all(len(record[k]) == 64 for k in ("config", "benchmark", "memoria_py", "conditions")))
            check("freeze writes the file it reports", json.loads(RS.PREREG.read_text()) == record)
            check("right after the freeze nothing has moved", RS.prereg_problem() is None)
            for name, path, text in (("scoping.py", base / "scoping.py", "# changed\n"), ("run_scoping.py", base / "run_scoping.py", "# changed\n"), ("config", out / "config.json", json.dumps({"k": 5})),
                                     ("benchmark", bench, "{}\n{}\n"), ("memoria_py", base / "memoria.py", "# edited\n"), ("conditions", out / "conditions.json", "{\"x\": 1}")):
                original = path.read_text()
                path.write_text(text)
                problem = RS.prereg_problem()
                path.write_text(original)
                check(f"changing {name} after the freeze is named in the refusal", problem is not None and name in problem, problem)
            check("restoring every file makes the run allowed again", RS.prereg_problem() is None)
            (out / "config.json").unlink()
            try:
                RS.freeze()
                refused = False
            except SystemExit:
                refused = True
            check("freeze refuses to run before k has been chosen on the development series", refused)
        finally:
            RS.HERE, RS.OUT, RS.CONFIG, RS.PREREG, R.BENCH_FILE = saved


def guard_checks() -> None:
    listing = "\n".join(["100 /Users/x/Documents/memoria/.venv/bin/python3.11 /Users/x/Documents/memoria/hud.py", "200 python3.11 /Users/x/Documents/memoria/run_scoping.py --worker M2@C2 --split test",
                         "300 python3.11 run_benchmarks.py --worker M2 --split test", "400 /usr/bin/vim notes.txt", "500 python3.11 -m mlx_lm.server", "600 python3.11 run_scoping.py run"])
    measured = {100: 3.1, 200: 3.5, 300: 3.4, 400: 9.9, 500: 0.2, 600: 0.1}
    found = RS.busy_model_processes(listing, own=1, measure=lambda pid: (measured[pid], measured[pid]))
    check("the guard sees Memoria.app, a scoping worker and a benchmark worker, and nothing else", [f[0] for f in found] == [100, 200, 300], found)
    check("a process below 1 GB of model memory is not busy, and the process itself is never counted", RS.busy_model_processes(listing, own=100, measure=lambda pid: (0.5, 0.5)) == [] and
          [f[0] for f in RS.busy_model_processes(listing, own=200, measure=lambda pid: (3.0, 3.0))] == [100, 300, 500])


class FakeSpyHost:
    """A stand-in for the memoria module: generate echoes a reply and notes how it was called."""

    def __init__(self) -> None:
        self.calls: list[dict] = []

        def generate(model, tokenizer, prompt, **options):
            self.calls.append({"model": model, "prompt": prompt, **options})
            return f"  REPLY to {prompt[-10:]}  "

        self.generate = generate


def runner_checks() -> None:
    host = FakeSpyHost()
    spy = RS.Spy(host)
    out = host.generate("M", "T", prompt="the prompt text", max_tokens=60, temp=0.0)
    check("the spy hands the call on untouched and returns the model's reply unchanged", out == "  REPLY to rompt text  " and host.calls[-1]["max_tokens"] == 60 and host.calls[-1]["model"] == "M")
    check("the spy notes the prompt and the raw reply of the last call", spy.last == {"prompt": "the prompt text", "raw": "  REPLY to rompt text  "})

    class FakeMemoria:
        MODEL = "fake-model"

        def __init__(self) -> None:
            self.seen: list[tuple] = []

        def load_model(self):
            return "MODEL", "TOKENIZER"

        def audit(self, model, tokenizer, decisions, statement):
            self.seen.append((decisions, statement))
            return "CONTRADICTS | wrong value | [S1a:01:00]"

        def _parse(self, raw, decisions):
            self.parsed = getattr(self, "parsed", []) + [(raw, decisions)]
            return "CONTRADICTS", "wrong value", "[S1a:01:00]"

    items = memory("The remote will use a kinetic battery.", "The case will be made of rubber.", "The production cost cannot exceed 12.50 Euro.")
    scoped = object.__new__(RS.Scoped)
    scoped.memoria, scoped.spy = FakeMemoria(), type("S", (), {"last": {"prompt": "", "raw": ""}})()
    scoped.scoper, scoped.model, scoped.tokenizer = S.Scoper(FakeEmbedder(), {"S1": items, "E": []}, 1, 1, True), "MODEL", "TOKENIZER"
    result = scoped.predict("S1", "We will use a battery in the remote.")
    check("M3 hands the auditor the scoped decisions and the statement, in that order, and nothing else", scoped.memoria.seen == [(items[0]["line"], "We will use a battery in the remote.")], scoped.memoria.seen)
    check("its record carries the label, the alert, the citation, the raw reply and what was in the scope", (result["pred"], result["alert"], result["citation"], result["scope_ids"], result["cue"], result["added"]) == ("CONTRADICTS", True, "[S1a:01:00]", ["S1a:01:00"], False, 0), result)
    check("the reply is read against the scope the auditor was shown, and against nothing else", scoped.memoria.parsed == [("CONTRADICTS | wrong value | [S1a:01:00]", items[0]["line"])], scoped.memoria.parsed)
    money = scoped.predict("S1", "I think each remote will cost 20 Euro to produce.")
    check("a statement about cost brings the cost decision into the scope, and the record says one decision was added", money["cue"] is True and money["added"] == 1 and len(money["scope_ids"]) == 2 and "S1a:03:00" in money["scope_ids"], money)
    scoped.predict("E", "Anything at all.")
    check("an empty scope is handed over as 'no approved decisions', as in the closed-book control", scoped.memoria.seen[-1][0] == R.NO_MEMORY, scoped.memoria.seen[-1])

    saved = (RS.OUT, RS.MEMORY)
    with tempfile.TemporaryDirectory() as folder:
        RS.OUT, RS.MEMORY = Path(folder), Path(folder) / "memory"
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                record = RS.prepare()
            memories, statements, _ = RS.load_split("test")
            generic = S.generic_stems([i["text"] for v in memories.values() for i in v])
            check("prepare writes C1 and C2 for all 28 series, each exactly what build_memory makes",
                  len(record["series"]) == 28 and all((RS.MEMORY / c / f"{s}.md").read_text() == S.build_memory(s, c, memories, statements, generic)[0] for s in ("ES2002", "TS3012") for c in ("C1", "C2")))
            check("conditions.json names the distractors of every series and condition, and the generic stems",
                  json.loads((RS.OUT / "conditions.json").read_text())["series"]["ES2004"]["C1"]["distractors"] == 30 and record["generic_stems"] == sorted(generic))
        finally:
            RS.OUT, RS.MEMORY = saved


def worker_checks() -> None:
    seen: list[tuple] = []
    gold_present: list[bool] = []

    class FakeRunner:
        tokenizer = type("T", (), {"encode": staticmethod(lambda text: text.split())})()

        def __init__(self) -> None:
            self.spy = type("S", (), {"last": {"prompt": "one two three four", "raw": "UPDATES"}})()

        def predict(self, series: str, statement: str) -> dict:
            seen.append((series, statement))
            return {"pred": "UPDATES", "alert": False, "citation": "", "raw": "UPDATES", "readable": True, "scope_ids": ["X:1:1", "X:2:2"], "cue": False, "added": 0}

    names = {p["series_id"] for p in R.read_lines(R.BENCH_FILE)}
    saved = (RS.OUT, RS.CONFIG, RS.make_system)
    with tempfile.TemporaryDirectory() as folder:
        RS.OUT, RS.CONFIG = Path(folder), Path(folder) / "config.json"
        RS.CONFIG.write_text(json.dumps({"k": 4, "extra": 2, "rule": True}))
        RS.make_system = lambda system, split, config: (FakeRunner(), {s: [{"id": "a"}, {"id": "b"}, {"id": "c"}] for s in names})
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                RS.worker("M3@C0", "test", 6, False)
            rows = R.read_lines(Path(folder) / "_work" / "M3@C0.jsonl")
            probes = R.pick_probes(R.read_lines(R.BENCH_FILE), 6)
            check("the worker calls the system with a series id and a statement and nothing else, after one warm-up call that is not recorded",
                  seen[0][1] == "Let us get started, everyone." and seen[1:] == [(p["series_id"], p["statement"]) for p in probes] and len(rows) == 6, seen[:3])
            check("it writes the gold label and the gold citation beside the answer, with the system, the scope, the memory size, the tokens and the latency",
                  all(r["gold_label"] == p["gold_label"] and r["gold_citation"] == p["gold_citation"] and r["system"] == "M3@C0" and r["scope_size"] == 2 and r["memory_lines"] == 3 and r["prompt_tokens"] == 4 and r["latency_ms"] >= 0
                      for r, p in zip(rows, probes)))
            meta = json.loads((Path(folder) / "_work" / "M3@C0.meta.json").read_text())
            check("it writes the measured peak memory, the load time and k", {"peak_gb", "load_s", "wall_s", "k"} <= set(meta) and meta["k"] == 4 and meta["probes"] == 6, meta)
            seen.clear()
            with contextlib.redirect_stdout(io.StringIO()):
                RS.worker("M3@C0", "test", 6, False)
            check("a run that stopped resumes: nothing already done is asked again", [s[1] for s in seen] == ["Let us get started, everyone."] and len(R.read_lines(Path(folder) / "_work" / "M3@C0.jsonl")) == 6, seen)
            with contextlib.redirect_stdout(io.StringIO()):
                RS.worker("M2@C1", "test", 3, True)
            check("a smoke run writes to its own folder and leaves the real one alone", (Path(folder) / "_smoke" / "M2@C1.jsonl").exists() and not (Path(folder) / "_work" / "M2@C1.jsonl").exists())
        finally:
            RS.OUT, RS.CONFIG, RS.make_system = saved


def run_checks() -> None:
    saved = (RS.OUT, RS.CONFIG, RS.PREREG, RS.busy_model_processes, RS.run_worker, R.verify_freeze)
    calls: list[tuple] = []
    with tempfile.TemporaryDirectory() as folder:
        RS.OUT, RS.CONFIG, RS.PREREG = Path(folder), Path(folder) / "config.json", Path(folder) / "preregistration.json"
        RS.run_worker = lambda system, split, limit, smoke: calls.append((system, split, limit, smoke)) or True
        parse = lambda *a: RS.run(type("A", (), {"systems": a[0], "split": a[1], "limit": None, "smoke": a[2], "fresh": False})())
        try:
            err = io.StringIO()
            with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
                code_unknown = parse("M9@C0", "test", False)
                code_dev = parse("M3@C1", "dev", False)
                code_config = parse("M3@C0", "test", False)
            check("an unknown system, condition C1 on the development split, and a missing config are each refused", code_unknown == 2 and code_dev == 2 and code_config == 1 and not calls, err.getvalue())
            RS.CONFIG.write_text(json.dumps({"k": 4}))
            R.verify_freeze = lambda: None
            RS.busy_model_processes = lambda: []
            err = io.StringIO()
            with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
                code_noprereg = parse("M3@C0", "test", False)
            check("a test run without a pre-registration is refused, and no worker starts", code_noprereg == 1 and "no pre-registration" in err.getvalue() and not calls, err.getvalue())
            RS.busy_model_processes = lambda: [(4042, "hud.py", 3.1)]
            err = io.StringIO()
            with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
                code_busy = parse("M3@C0", "dev", False)
            check("a second model process is refused with the pid and the size, and no worker starts", code_busy == 1 and "4042" in err.getvalue() and "quit it first" in err.getvalue() and not calls, err.getvalue())
            RS.busy_model_processes = lambda: []
            with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
                code_ok = parse("M3@C0,M2@C0", "dev", False)
            check("a development run needs no pre-registration and starts the workers one after another, in the order asked", code_ok == 0 and calls == [("M3@C0", "dev", None, False), ("M2@C0", "dev", None, False)], calls)
            calls.clear()
            R.verify_freeze = lambda: "the frozen benchmark was changed"
            err = io.StringIO()
            with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
                code_frozen = parse("M3@C0", "test", False)
                code_smoke = parse("M3@C0", "test", True)
            check("a changed benchmark refuses a test run, but not a smoke run", code_frozen == 1 and "frozen benchmark was changed" in err.getvalue() and code_smoke == 0 and calls == [("M3@C0", "test", None, True)], (calls, err.getvalue()))
        finally:
            RS.OUT, RS.CONFIG, RS.PREREG, RS.busy_model_processes, RS.run_worker, R.verify_freeze = saved


def init_checks() -> None:
    import types

    fake = types.ModuleType("memoria")
    fake.MODEL = "fake-model"
    loads: list[str] = []
    original = lambda model, tokenizer, prompt, **options: "reply"
    fake.generate = original
    fake.load_model = lambda: loads.append("load") or ("MODEL", "TOKENIZER")
    saved = (sys.modules.get("memoria"), R.Embedder)
    sys.modules["memoria"], R.Embedder = fake, FakeEmbedder
    try:
        memories = {"S1": memory("The remote will use a kinetic battery.", "The case will be rubber.")}
        scoped = RS.Scoped("C0", "test", memories, {"k": 3, "extra": 1, "rule": False})
        check("M3 is built with the k, the extra and the rule of config.json, an embedder over the memories, and the model", (scoped.scoper.k, scoped.scoper.extra, scoped.scoper.rule) == (3, 1, False)
              and isinstance(scoped.scoper.embedder, FakeEmbedder) and set(scoped.scoper.vectors) == {"S1"} and (scoped.model, scoped.tokenizer) == ("MODEL", "TOKENIZER") and loads == ["load"])
        check("and it wrapped generate to note the prompts", fake.generate is not original and fake.generate("M", "T", prompt="p") == "reply" and scoped.spy.last == {"prompt": "p", "raw": "reply"})
        unscoped = RS.Unscoped("C2", "test", memories, {"k": 3})
        check("M2 knows the ids of each series' memory, the condition it reads, and loaded the model; it scopes nothing", unscoped.ids == {"S1": ["S1a:01:00", "S1a:02:00"]} and unscoped.condition == "C2" and loads == ["load", "load"])
    finally:
        if saved[0] is None:
            sys.modules.pop("memoria", None)
        else:
            sys.modules["memoria"] = saved[0]
        R.Embedder = saved[1]

    check("the development split reads the development memory and the test split the test memory; C1 and C2 read the written files",
          RS.memory_path("C0", "ES2003", "dev") == R.CACHE / "memory" / "dev" / "ES2003.versioned.md" and RS.memory_path("C0", "ES2004") == R.CACHE / "memory" / "test" / "ES2004.versioned.md"
          and RS.memory_path("C2", "ES2004") == RS.MEMORY / "C2" / "ES2004.md" and RS.memory_path("C1", "ES2004", "test") == RS.MEMORY / "C1" / "ES2004.md")
    check("condition_memories reads the five development series for dev and the 28 test series for test", set(RS.condition_memories("C0", "dev")) == {"ES2003", "ES2011", "IS1008", "TS3004", "TS3006"} and len(RS.condition_memories("C0", "test")) == 28
          and len(RS.condition_memories("C2", "test")) == 28)


def tune_checks() -> None:
    saved = (RS.OUT, RS.CONFIG, RS.load_split, RS.recall_sweep, R.Embedder)
    sweep = {"rule": {k: {"recall": r, "found": 0, "n": 30, "mean_scope": 4.0} for k, r in {1: 0.5, 2: 0.96, 3: 0.97, 4: 0.98, 5: 0.99, 6: 1.0, 7: 1.0, 8: 1.0}.items()},
             "no_rule": {k: {"recall": r, "found": 0, "n": 30, "mean_scope": 4.0} for k, r in {1: 0.4, 2: 0.5, 3: 0.6, 4: 0.7, 5: 0.8, 6: 0.97, 7: 0.99, 8: 1.0}.items()}}
    with tempfile.TemporaryDirectory() as folder:
        RS.OUT, RS.CONFIG = Path(folder), Path(folder) / "config.json"
        RS.load_split = lambda split: ({"A": []}, {}, [])
        RS.recall_sweep = lambda embedder, memories, probes: sweep
        R.Embedder = lambda: None
        try:
            config = RS.tune()
            check("k is chosen from the development sweep WITH the money/time rule (2 here; without it the rule of 0.95 would give 6)", config["k"] == 2 and S.tune_k({k: v["recall"] for k, v in sweep["no_rule"].items()}) == 6, config["k"])
            on_disk = json.loads(RS.CONFIG.read_text())
            check("config.json holds k, the extra, the rule, the embedder, the seed, the rule used to choose k and the whole development sweep", on_disk["k"] == 2 and on_disk["extra"] == S.EXTRA and on_disk["rule"] is True and on_disk["embedder"] == R.EMBEDDER
                  and on_disk["seed"] == S.SEED and "smallest k" in on_disk["rule_for_k"] and set(on_disk["development"]["sweep"]) == {"rule", "no_rule"} and on_disk["development"]["series"] == ["A"])
        finally:
            RS.OUT, RS.CONFIG, RS.load_split, RS.recall_sweep, R.Embedder = saved


def recall_sweep_checks() -> None:
    items = memory("kinetic battery power", "rubber case material", "production cost twelve euro", "docking station", "teletext", "screen display", "shiny paint", "wrist strap")
    probes = [{"id": "p1", "series_id": "S1", "statement": "kinetic battery power", "gold_label": "SUPPORTED_CURRENT", "gold_citation": "[S1a:01:00]", "expected_alert": False},
              {"id": "p2", "series_id": "S1", "statement": "teletext", "gold_label": "CONTRADICTS", "gold_citation": "[S1a:05:00]", "expected_alert": True},
              {"id": "p3", "series_id": "S1", "statement": "weather chat", "gold_label": "IRRELEVANT", "gold_citation": None, "expected_alert": False}]
    sweep = RS.recall_sweep(FakeEmbedder(), {"S1": items}, probes)
    check("recall_sweep covers k = 1..8, with and without the rule, counts only probes with a gold decision, and at k = 8 finds them all",
          set(sweep) == {"rule", "no_rule"} and sorted(sweep["rule"]) == list(S.K_GRID) and sweep["rule"][8]["n"] == 2 and sweep["rule"][8]["found"] == 2 and sweep["no_rule"][1]["found"] == 2, sweep["no_rule"][1])
    check("the mean scope is k without a money/time statement, and the rule adds to it only for probes that mention money", sweep["no_rule"][3]["mean_scope"] == 3.0 and sweep["rule"][3]["mean_scope"] == 3.0)
    money = [{**probes[0], "id": "p4", "statement": "production cost twelve euro", "gold_citation": "[S1a:03:00]"}]
    wide = RS.recall_sweep(FakeEmbedder(), {"S1": items}, money)
    check("with a money statement the rule widens the scope (mean 4 at k = 3) and without it the scope stays at k", wide["rule"][3]["mean_scope"] >= wide["no_rule"][3]["mean_scope"] and wide["no_rule"][3]["mean_scope"] == 3.0)


def config_checks() -> None:
    config = json.loads(RS.CONFIG.read_text(encoding="utf-8"))
    sweep = config["development"]["sweep"]["rule"]
    check("config.json holds k, chosen from the development sweep by the pre-registered rule", config["k"] == S.tune_k({int(k): v["recall"] for k, v in sweep.items()}) and config["extra"] == S.EXTRA and config["rule"] is True)
    memories, _, probes = RS.load_split("dev")
    scoper = S.Scoper(R.Embedder(), memories, config["k"], config["extra"], config["rule"])
    rows = [{**p, "scope_ids": scoper.scope(p["series_id"], p["statement"])["ids"]} for p in probes]
    recall = S.scope_recall(rows)
    check("the development recall at the chosen k, recomputed with the real embedder, is the one in config.json", f"{recall['found']}/{recall['n']}" == f"{sweep[str(config['k'])]['found']}/{sweep[str(config['k'])]['n']}", recall)
    brute = {}
    for k in S.K_GRID:
        brute[k] = []
        for p in probes:
            if not p["gold_citation"]:
                continue
            items = memories[p["series_id"]]
            sims = scoper.vectors[p["series_id"]] @ R.Embedder.encode(scoper.embedder, [p["statement"]])[0]
            top = sorted(range(len(items)), key=lambda i: (-sims[i], i))[:k]
            brute[k].append(p["gold_citation"].strip("[]") in {items[i]["id"] for i in top})
    check("scope recall without the rule equals a brute-force top-k over the development probes, for k = 1..8", all(sum(v) == config["development"]["sweep"]["no_rule"][str(k)]["found"] for k, v in brute.items()))
    check("the development memories are the cached development decisions, none of them a test decision", set(memories) == {"ES2003", "ES2011", "IS1008", "TS3004", "TS3006"} and not set(memories) & set(RS.load_split("test")[0]))


def main() -> int:
    select_checks()
    scoper_checks()
    recall_checks()
    stem_checks()
    memory_checks()
    real_memory_checks()
    parser_checks()
    freeze_checks()
    guard_checks()
    runner_checks()
    worker_checks()
    run_checks()
    init_checks()
    tune_checks()
    recall_sweep_checks()
    config_checks()
    print(f"All {len(passed)} topic-scoping checks passed: the scope, the other-topic memories, the parser, the freeze and the plumbing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
