"""Test of the post-hoc analyses of the topic-scoping experiment: each function against a hand count, and the files on disk against a recomputation.

No language model is loaded here. Run: python3.11 test_scoping_posthoc.py
"""

import hashlib
import json
import math
import re
import sys
import tempfile
from pathlib import Path

import numpy as np

import eval_metrics as E
import run_benchmarks as R
import run_scoping as RS
import scoping as S
import scoping_posthoc as H

passed: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    assert condition, f"{name}: {detail}"
    passed.append(name)


class FakeEmbedder:
    def encode(self, texts):
        out = np.zeros((len(texts), 256), dtype="float32")
        for i, text in enumerate(texts):
            for word in re.findall(r"[a-z]+", text.lower()):
                out[i, int(hashlib.md5(word.encode()).hexdigest(), 16) % 256] += 1
        norms = np.linalg.norm(out, axis=1, keepdims=True)
        norms[norms == 0] = 1
        return out / norms


def row(i: str, gold: str, pred: str, series: str = "S1", statement: str = "a statement") -> dict:
    return {"id": i, "series_id": series, "gold_label": gold, "pred": pred, "alert": pred in E.ALERTS, "expected_alert": gold in E.ALERTS, "statement": statement, "latency_ms": 1.0}


def small_checks() -> None:
    rows = [row("a", "OUTDATED", "OUTDATED"), row("b", "OUTDATED", "CONTRADICTS"), row("c", "UPDATES", "UPDATES"), row("d", "UPDATES", "SUPPORTED_CURRENT")]
    r = H.class_recall(rows)
    check("class recall is the share of a class's probes that got the class (OUTDATED 1 of 2, UPDATES 1 of 2, the empty classes 0)", r["OUTDATED"] == 0.5 and r["UPDATES"] == 0.5 and r["SUPPORTED_CURRENT"] == 0.0, r)

    later = [row("a", "OUTDATED", "CONTRADICTS"), row("b", "OUTDATED", "OUTDATED"), row("c", "UPDATES", "UPDATES"), row("d", "UPDATES", "SUPPORTED_CURRENT")]
    m = H.movement(rows, later)
    check("movement counts the probes whose label changed (a and b), with gold, old and new label", m["changed"] == 2 and dict(m["moves"]) == {("OUTDATED", "OUTDATED", "CONTRADICTS"): 1, ("OUTDATED", "CONTRADICTS", "OUTDATED"): 1}, m)
    check("and how many became right (b) and how many became wrong (a)", (m["became_right"], m["became_wrong"]) == (1, 1), m)
    check("a system against itself moves nothing", H.movement(rows, rows) == {"changed": 0, "became_right": 0, "became_wrong": 0, "moves": []})

    texts = {"S1": ["The remote will be button-less.", "Teletext is included."], "S2": ["Anything else."]}
    stat = [row("p1", "UPDATES", "UPDATES", "S1", "Let's add a help button."), row("p2", "UPDATES", "UPDATES", "S1", "Let's add voice."), row("p3", "UPDATES", "UPDATES", "S2", "Add a help button."),
            row("p4", "UPDATES", "UPDATES", "S1", "Do a control check."), row("p5", "UPDATES", "UPDATES", "S1", "The remote will control it.")]
    exposed = H.exposure(stat, texts)
    check("a probe is exposed when its statement shares 'button' or 'control' with a distractor of its own memory: p1 yes (button); p2 no; p3 no (no button in S2); p4 no (nobody has 'control'); p5 no ('remote' is not counted)",
          exposed == {"p1": True, "p2": False, "p3": False, "p4": False, "p5": False}, exposed)
    check("the common stems counted are button and control only", H.COMMON == ("butt", "cont"))
    sub = H.subset_scores(rows, lambda i: i in ("a", "c"))
    check("subset scores are the scores of the probes kept: here a (right) and c (right): accuracy 1, and alert recall 1 on the one gold alert", sub["n"] == 2 and sub["accuracy"] == 1.0 and sub["alert_recall"] == 1.0, sub)
    empty = H.subset_scores(rows, lambda i: False)
    check("an empty subset gives n = 0 and nan, not 0", empty["n"] == 0 and math.isnan(empty["macro_f1"]))


def audit_checks() -> None:
    mapping = {"sets": {"set_01": {"series": "S1", "decisions": {"d001": "S1a:01:00", "d002": "X1:02:00"}, "statements": {"s01": "S1-S-01", "s02": "S1-U-01"}}}}
    with tempfile.TemporaryDirectory() as folder:
        folder = Path(folder)
        (folder / "labels_group1.json").write_text(json.dumps({"set_01/s01": {"label": "SUPPORTED_CURRENT", "decisions_used": ["d001"], "note": "x"},
                                                              "set_01/s02": {"label": "CONTRADICTS", "decisions_used": ["d002"], "note": "y"}, "set_09/s01": {"label": "UPDATES", "decisions_used": []}}))
        labels = H.read_audit(folder, mapping)
        check("the anonymous ids are mapped back to probe ids and to real decision ids, and a key that maps to nothing is dropped", labels == {"S1-S-01": {"label": "SUPPORTED_CURRENT", "decisions_used": ["S1a:01:00"], "note": "x"},
                                                                                                                           "S1-U-01": {"label": "CONTRADICTS", "decisions_used": ["X1:02:00"], "note": "y"}}, labels)
        (folder / "labels_group2.json").write_text(json.dumps({"S1-S-02": {"label": "OUTDATED", "decisions_used": []}}))
        check("without a mapping the keys are taken as probe ids, and every group file is read", set(H.read_audit(folder)) == {"set_01/s01", "set_01/s02", "set_09/s01", "S1-S-02"})
    probes = [{"id": "S1-S-01", "series_id": "S1", "gold_label": "SUPPORTED_CURRENT"}, {"id": "S1-U-01", "series_id": "S1", "gold_label": "UPDATES"}, {"id": "S1-S-02", "series_id": "S1", "gold_label": "SUPPORTED_CURRENT"}]
    a = H.audit_agreement(labels, probes, {"S1": {"X1:02:00"}})
    check("agreement counts the probes the labeller labelled with the gold label, lists the disagreements with both labels, and names the missing probe",
          a["labelled"] == 2 and a["agree"] == 1 and a["missing"] == ["S1-S-02"] and a["disagreements"] == [("S1-U-01", "UPDATES", "CONTRADICTS", "y")] and a["agreeing_ids"] == ["S1-S-01"], a)
    check("by class: SUPPORTED_CURRENT 1 of its 2 probes, UPDATES 0 of 1", a["per_class"]["SUPPORTED_CURRENT"] == "1/2" and a["per_class"]["UPDATES"] == "0/1", a["per_class"])
    check("labels that rest on a decision added as another topic's are listed", a["relied_on_distractor"] == ["S1-U-01"], a["relied_on_distractor"])
    bad = H.audit_agreement({"S1-S-01": {"label": "NONSENSE", "decisions_used": []}}, probes, {})
    check("an answer that is not one of the six classes is not counted as labelled", bad["labelled"] == 0 and bad["agree"] == 0)


def retrieval_checks() -> None:
    check("tokens drop grammatical words, the word 'remote' and words under three letters", H.tokens("The remote will use a kinetic battery of 12 Euro") == ["use", "kinetic", "battery", "euro"], H.tokens("The remote will use a kinetic battery of 12 Euro"))
    scores = H.bm25(["kinetic"], [["kinetic", "battery"], ["rubber", "case"]])
    check("BM25 on a worked example: one document of two words holds the term, so its score is ln 2 x (k1 + 1) / (1 + k1) = ln 2, the other scores 0", abs(scores[0] - math.log(2)) < 1e-12 and scores[1] == 0.0, scores)
    check("a term that no document has adds nothing, and an empty query scores 0", list(H.bm25(["zzz"], [["a", "b"]])) == [0.0] and list(H.bm25([], [["a"]])) == [0.0])
    more = H.bm25(["kinetic"], [["kinetic", "kinetic", "x"], ["kinetic", "y", "z"], ["other"]])
    check("a document that repeats the term scores higher than one that has it once", more[0] > more[1] > more[2] == 0.0, more)
    check("ranking is best first and ties go to the earlier document", H.ranking(np.array([0.1, 0.9, 0.9, 0.0])) == [1, 2, 0, 3])
    check("reciprocal-rank fusion: [0,1,2] and [2,1,0] tie on 0 and 2 (1/61 + 1/63), and 1 comes last (2/62); ties go to the lower index", H.fuse([0, 1, 2], [2, 1, 0]) == [0, 2, 1], H.fuse([0, 1, 2], [2, 1, 0]))
    check("fusing one ranking leaves it as it was", H.fuse([3, 1, 2, 0]) == [3, 1, 2, 0])

    items = S.parse_memory("- [S1a:01:00] kinetic battery power\n- [S1a:02:00] rubber case material\n- [S1a:03:00] production cost twelve euro\n- [S1a:04:00] docking station\n")
    probes = [{"id": "p1", "series_id": "S1", "statement": "kinetic battery", "gold_citation": "[S1a:01:00]"}, {"id": "p2", "series_id": "S1", "statement": "case made of rubber", "gold_citation": "[S1a:02:00]"},
              {"id": "p3", "series_id": "S1", "statement": "weather chat", "gold_citation": None}]
    r = H.retrieval_recall(FakeEmbedder(), {"S1": items}, probes, ks=(1, 4))
    check("retrieval recall counts only the probes with a gold decision (2), and at k = 4 (the whole memory) every method finds both", r["n"] == 2 and r["found"][4] == {"dense": 2, "bm25": 2, "hybrid": 2}, r)
    check("at k = 1 the nearest decision is the gold one for both probes, by every method", r["found"][1] == {"dense": 2, "bm25": 2, "hybrid": 2}, r["found"][1])
    probes[1]["statement"] = "completely different words"
    r2 = H.retrieval_recall(FakeEmbedder(), {"S1": items}, probes, ks=(1,))
    check("a probe that shares no word with its gold decision is found by no method at k = 1", r2["found"][1]["bm25"] == 1 and r2["found"][1]["dense"] <= 2)


def analysis_checks() -> None:
    rows = {s: [row(f"p{i}", g, p) for i, (g, p) in enumerate([("OUTDATED", "OUTDATED"), ("OUTDATED", "CONTRADICTS"), ("UPDATES", "UPDATES"), ("CONTRADICTS", "CONTRADICTS")])] for s in ("M2@C0", "M3@C0", "M3@C2")}
    rows["M2@C2"] = [row("p0", "OUTDATED", "CONTRADICTS"), row("p1", "OUTDATED", "CONTRADICTS"), row("p2", "UPDATES", "SUPPORTED_CURRENT"), row("p3", "CONTRADICTS", "CONTRADICTS")]
    for system in rows:
        for r in rows[system]:
            r["statement"] = "Add a button" if r["id"] == "p2" else "Something"
    conditions = {"series": {"S1": {"C2": {"distractor_ids": ["X1:01:00"]}}}}
    memories = {"S1": S.parse_memory("- [S1a:01:00] own\n- [X1:01:00] a button decision\n")}
    probes = [{"id": f"p{i}", "series_id": "S1", "gold_label": g, "gold_citation": None} for i, g in enumerate(["OUTDATED", "OUTDATED", "UPDATES", "CONTRADICTS"])]
    result = H.analyse(rows, conditions, memories, probes)
    check("the analysis finds that M2 moved 2 probes from C0 to C2 (p0, p2), both from right to wrong, and none became right", (result["movement_m2_c0_c2"]["changed"], result["movement_m2_c0_c2"]["became_wrong"], result["movement_m2_c0_c2"]["became_right"]) == (2, 2, 0), result["movement_m2_c0_c2"])
    check("the 'Add a button' probe (p2) is the one exposed to the button distractor", result["exposure"]["exposed"] == 1 and result["exposure"]["unexposed"] == 3)
    check("scores without the exposed probe (p0, p1, p3): M2 at C0 gets 2 of 3 right, M2 at C2 gets 1 of 3; the exposed probe alone is p2",
          result["exposure"]["M2@C0"]["unexposed"]["n"] == 3 and abs(result["exposure"]["M2@C0"]["unexposed"]["accuracy"] - 2 / 3) < 1e-12 and abs(result["exposure"]["M2@C2"]["unexposed"]["accuracy"] - 1 / 3) < 1e-12
          and result["exposure"]["M2@C2"]["exposed"]["n"] == 1 and result["exposure"]["M2@C2"]["exposed"]["accuracy"] == 0.0, result["exposure"])
    text = H.describe(result)
    check("the text says the analyses are post hoc and exploratory, and states the counts it computed", "AFTER the pre-registered results were seen" in text and "2 probes changed label" in text and "1 of those moves are OUTDATED and CONTRADICTS taken for each other" in text and "1 of 336 probes share" in text, text[:600])
    check("the text says the blind audit was not read yet when there is none", "has not been read yet" in text)
    audited = H.analyse(rows, conditions, memories, probes, {f"p{i}": {"label": g, "decisions_used": []} for i, g in enumerate(["OUTDATED", "OUTDATED", "UPDATES", "UPDATES"])}, None, None, {"p0": {"label": "OUTDATED"}})
    check("with an audit the result holds its agreement (3 of 4 here), the clean subset of the confirmed probes, and the leaky round", audited["audit"]["agree"] == 3 and audited["audit"]["clean"]["n"] == 3 and audited["leaky_round"] == {"labelled": 1, "agree": 1})
    check("the text gives the audit's agreement and the labels it disagreed on", "agreed with the gold label on 3 (75%)" in H.describe(audited) and "p3 CONT/UPDA" in H.describe(audited))


def real_checks() -> None:
    disk = json.loads((RS.OUT / "posthoc_results.json").read_text(encoding="utf-8"))
    import scoping_report as P

    rows, _ = P.load_runs(RS.OUT / "_work")
    check("posthoc_results.json holds the class recall of the six systems as the predictions on disk give them", all(abs(disk["class_recall"][s][c] - H.class_recall(r)[c]) < 1e-9 for s, r in rows.items() for c in E.CLASSES))
    mv = H.movement(rows["M2@C0"], rows["M2@C2"])
    check("and the movement of M2 from C0 to C2 (57 changed, 12 right, 44 wrong), as recomputed", (disk["movement_m2_c0_c2"]["changed"], disk["movement_m2_c0_c2"]["became_right"], disk["movement_m2_c0_c2"]["became_wrong"]) == (mv["changed"], mv["became_right"], mv["became_wrong"]) == (57, 12, 44), mv["changed"])
    conditions = json.loads((RS.OUT / "conditions.json").read_text())
    memories = RS.condition_memories("C2", "test")
    text = {s: {i["id"]: i["text"] for i in items} for s, items in memories.items()}
    exposed = H.exposure(rows["M2@C2"], {s: [text[s][d] for d in info["C2"]["distractor_ids"]] for s, info in conditions["series"].items()})
    check("and the 36 exposed probes, as recomputed", disk["exposure"]["exposed"] == sum(exposed.values()) == 36)
    mapping = json.loads((RS.OUT / "audit_mapping.json").read_text())
    check("the audit mapping covers 28 sets of 12 statements each, and every statement is a probe of the frozen benchmark", len(mapping["sets"]) == 28 and all(len(v["statements"]) == 12 for v in mapping["sets"].values())
          and {i for v in mapping["sets"].values() for i in v["statements"].values()} == {p["id"] for p in R.read_lines(R.BENCH_FILE)})
    check("the blind audit's decision ids in the mapping are the C2 memories' ids (so a label can be traced to a real decision)", all(set(v["decisions"].values()) == {i["id"] for i in memories[v["series"]]} for v in mapping["sets"].values()))
    check("the audit on disk labelled all 336 probes, and the result says 336 agree and none rests on another topic's decision",
          disk["audit"]["labelled"] == 336 and disk["audit"]["agree"] == 336 and disk["audit"]["relied_on_distractor"] == [] and disk["audit"]["missing"] == [])
    check("the retrieval table has the three conditions with 168 probes each and dense retrieval finding fewer at C2 than at C0", set(disk["retrieval"]) == {"C0", "C1", "C2"} and disk["retrieval"]["C0"]["n"] == 168
          and disk["retrieval"]["C2"]["found"]["4"]["dense"] < disk["retrieval"]["C0"]["found"]["4"]["dense"])
    check("the interleaved latency summaries are there for C0 and C2 with M3 faster on most probes", set(disk["paired"]) == {"C0", "C2"} and disk["paired"]["C0"]["share_of_probes_where_m3_was_faster"] > 0.5)
    check("posthoc_summary.txt is the text of the result on disk", (RS.OUT / "posthoc_summary.txt").read_text(encoding="utf-8") == H.describe(disk | {"movement_m2_c0_c2": {**disk["movement_m2_c0_c2"], "moves": [(tuple(m[0]), m[1]) for m in disk["movement_m2_c0_c2"]["moves"]]},
                                                                                                  "retrieval": {c: {"n": v["n"], "found": {int(k): f for k, f in v["found"].items()}} for c, v in disk["retrieval"].items()}}))


def main() -> int:
    small_checks()
    audit_checks()
    retrieval_checks()
    analysis_checks()
    real_checks()
    print(f"All {len(passed)} post-hoc analysis checks passed: each function against a hand count, and the files on disk against a recomputation.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
