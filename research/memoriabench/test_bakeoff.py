"""Test of the retriever bake-off: the memories it retrieves from, the recall it counts, the pre-registered rule, and the text it writes.

No embedder is loaded here. Embeddings are invented: a "perfect" one (a decision's vector is its own unit vector, a statement's is the vector of its
gold decision) shows that the plumbing finds what is there; a blind one shows that it does not invent it. Run: python3.11 test_bakeoff.py
"""

import json
import re
import sys
import tempfile
from pathlib import Path

import numpy as np

import retriever_bakeoff as B
import run_scoping as RS
import scoping as S
import scoping_posthoc as H

passed: list[str] = []


def check(name: str, condition: bool, detail: object = "") -> None:
    assert condition, f"{name}: {detail}"
    passed.append(name)


def memories_checks(c: dict) -> None:
    test = c["test"]["memories"]
    c3 = B.memories_for("test", c, "C3")
    check("C3 holds, for every test series, its own decisions and every other series' decisions: 367 in all, each exactly once", all(len(v) == 367 for v in c3.values()) and all(len({i["id"] for i in v}) == 367 for v in c3.values()))
    check("the own decisions of a series are all in its C3, and the other series' decisions are labelled with their source",
          all({i["id"] for i in test[s]} <= {i["id"] for i in c3[s]} for s in test) and all(sum(i["source"] == s for i in c3[s]) == len(test[s]) for s in test))
    check("C3 is shuffled (own decisions are not all at the top) and deterministic", any(i["source"] != "ES2004" for i in c3["ES2004"][:len(test["ES2004"])]) and B.unfiltered_memory("ES2004", test) == B.unfiltered_memory("ES2004", test))
    check("C3 differs from series to series", [i["id"] for i in c3["ES2004"]] != [i["id"] for i in c3["ES2005"]])

    for condition in ("C0", "C1", "C2"):
        built = B.memories_for("test", c, condition)
        on_disk = RS.condition_memories(condition, "test")
        check(f"the test {condition} memories are those of the scoping experiment, line for line", all([i["id"] for i in built[s]] == [i["id"] for i in on_disk[s]] for s in test), condition)
    dev = c["dev"]["memories"]
    d0, d1, d2, d3 = (B.memories_for("dev", c, k) for k in ("C0", "C1", "C2", "C3"))
    check("the development C0 is the development series' own decisions", all([i["id"] for i in d0[s]] == [i["id"] for i in dev[s]] for s in dev))
    check("the development C1 and C2 hold the own decisions plus other-topic decisions taken from the other development series and the test series, never the series' own twice",
          all({i["id"] for i in dev[s]} <= {i["id"] for i in d2[s]} and len({i["id"] for i in d2[s]}) == len(d2[s]) for s in dev) and all(len(d1[s]) <= len(dev[s]) + 30 and len(d2[s]) <= len(dev[s]) + 150 for s in dev))
    check("some development distractors come from test series, none is in the series itself", any(i["id"][:6] in {t for t in test} for s in dev for i in d2[s]) and not any(i["id"].startswith(s) for s in dev for i in d2[s] if i["id"] not in {j["id"] for j in dev[s]}))
    check("the development C3 holds the 61 development decisions and the 367 test decisions, each once", all(len(d3[s]) == 61 + 367 and len({i["id"] for i in d3[s]}) == 61 + 367 for s in dev))


def recall_checks() -> None:
    items = {"S": S.parse_memory("- [S:1] a\n- [S:2] b\n- [S:3] c\n- [S:4] d\n- [S:5] e\n")}
    probes = [{"id": "p1", "series_id": "S", "gold_citation": "[S:2]"}, {"id": "p2", "series_id": "S", "gold_citation": "[S:5]"}, {"id": "p3", "series_id": "S", "gold_citation": None}]
    ranks = [[1, 0, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4]]
    r = B.recall_at(ranks, probes, items, ks=(1, 2, 5))
    check("recall counts the probes with a gold decision (2), and the gold decision within the top k: p1 at rank 1, p2 at rank 5", r["n"] == 2 and r["found"] == {1: 1, 2: 1, 5: 2}, r)
    twins = {"S": S.parse_memory("- [S:1] same words\n- [S:2] other\n- [T:9] same words\n- [S:4] more\n")}
    twin_probes = [{"id": "p1", "series_id": "S", "gold_citation": "[S:1]"}]
    t = B.recall_at([[2, 1, 0, 3]], twin_probes, twins, ks=(1, 2, 3))
    check("a decision with the same words as the gold one (another group's, id T:9) counts in the post-hoc count from k = 1, in the pre-registered count only once the gold id itself is in the top k",
          t["found"] == {1: 0, 2: 0, 3: 1} and t["found_text"] == {1: 1, 2: 1, 3: 1}, t)
    dense = {"S": np.eye(5, dtype="float32")}
    q = [np.eye(5, dtype="float32")[2], np.eye(5, dtype="float32")[4], np.zeros(5, dtype="float32")]
    check("dense ranks the item whose vector matches the query first", B.rankings_for("dense", probes, items, dense, q)[0][0] == 2 and B.rankings_for("dense", probes, items, dense, q)[1][0] == 4)
    lex = [{**probes[0], "statement": "kinetic battery"}, {**probes[1], "statement": "rubber case"}, {**probes[2], "statement": "x"}]
    words = {"S": S.parse_memory("- [S:1] kinetic battery power\n- [S:2] rubber case material\n- [S:3] teletext\n- [S:4] screen\n- [S:5] strap\n")}
    ranking = B.rankings_for("bm25", lex, words, None, None)
    check("BM25 ranks the decision that shares the statement's words first, and needs no vectors", ranking[0][0] == 0 and ranking[1][0] == 1)
    hybrid = B.rankings_for("hybrid", lex, words, {"S": np.eye(5, dtype="float32")}, [np.eye(5, dtype="float32")[0], np.eye(5, dtype="float32")[4], np.zeros(5, dtype="float32")])
    check("the hybrid fuses the two rankings: p1 (both put item 0 first) keeps it first; p2 (dense says item 4, BM25 says item 1) puts item 1 first, then item 0 (second in both), then item 4 (first in one, last in the other)",
          hybrid[0][0] == 0 and hybrid[1][:3] == [1, 0, 4], hybrid[:2])


def evaluate_checks(c: dict) -> None:
    texts = json.loads((B.BAKE / "texts.json").read_text(encoding="utf-8"))
    doc_index = {t: i for i, t in enumerate(texts["docs"])}
    query_index = {q: i for i, q in enumerate(texts["query_ids"])}
    docs = np.eye(len(texts["docs"]), dtype="float32")
    gold_text = {}
    for split in ("test", "dev"):
        for p in c[split]["probes"]:
            if p["gold_citation"]:
                wanted = p["gold_citation"].strip("[]")
                gold_text[p["id"]] = next(i["text"] for i in c[split]["memories"][p["series_id"]] if i["id"] == wanted)
    perfect_q = np.zeros((len(texts["queries"]), len(texts["docs"])), dtype="float32")
    for pid, text in gold_text.items():
        perfect_q[query_index[pid], doc_index[text]] = 1.0
    blind_q = np.zeros_like(perfect_q)
    result = B.evaluate(c, {"perfect": {"docs": docs, "queries": perfect_q}, "blind": {"docs": docs, "queries": blind_q}}, doc_index, query_index)
    check("the result has the test and the development series, the four conditions, and BM25 plus a dense and a hybrid retriever for each embedder",
          set(result) == {"test", "dev"} and set(result["test"]) == set(B.CONDITIONS) and set(result["test"]["C0"]) == {"bm25", "perfect dense", "perfect hybrid", "blind dense", "blind hybrid"})
    check("168 probes with a gold decision on the test series and 30 on the development series", result["test"]["C0"]["bm25"]["n"] == 168 and result["dev"]["C0"]["bm25"]["n"] == 30)
    check("a perfect embedder finds the gold decision in the top 4 in every condition, even among 367 decisions (ties between identical sentences aside)",
          all(result[s][c_]["perfect dense"]["found"][4] >= result[s][c_]["perfect dense"]["n"] - 2 for s in result for c_ in B.CONDITIONS), {s: {c_: result[s][c_]["perfect dense"]["found"] for c_ in B.CONDITIONS} for s in result})
    check("a blind embedder (every similarity 0) finds only by position: well below the perfect one at k = 4 in C3, but 100% at k = 12 when the memory has at most 12 decisions",
          result["test"]["C3"]["blind dense"]["found"][4] < 40 and result["test"]["C3"]["perfect dense"]["found"][4] > 160)
    check("BM25 does not depend on the embedders, so it is the same whatever is passed", B.evaluate(c, {"perfect": {"docs": docs, "queries": perfect_q}}, doc_index, query_index)["test"]["C2"]["bm25"] == result["test"]["C2"]["bm25"])
    check("recall never falls as k grows", all(x["found"][4] <= x["found"][8] <= x["found"][12] for s in result for cc in result[s].values() for x in cc.values()))
    check("more memory makes BM25 find less (C0 at least as good as C3 at k = 4)", result["test"]["C0"]["bm25"]["found"][4] >= result["test"]["C3"]["bm25"]["found"][4])


def rule_checks() -> None:
    def res(c2: int, c3: int) -> dict:
        x = lambda f: {"n": 168, "found": {4: f, 8: f, 12: f}}
        return {"test": {"C2": {"r": x(c2)}, "C3": {"r": x(c3)}}}
    check("recall-safe needs at least 0.95 at k = 8 in C2 AND in C3: 160 of 168 is 95.2% and passes", B.recall_safe(res(160, 160), "r") and B.SAFE_RECALL == 0.95 and B.SAFE_K == 8)
    check("159 of 168 in either condition fails", not B.recall_safe(res(159, 168), "r") and not B.recall_safe(res(168, 159), "r"))
    check("168 in both passes", B.recall_safe(res(168, 168), "r"))
    check("the rule is the one written in the module's text", "at least 0.95 on the test series in C2 AND in C3" in B.__doc__ and "k = 8" in B.__doc__)


def files_checks() -> None:
    with tempfile.TemporaryDirectory() as folder:
        folder = Path(folder)
        eye = np.eye(3, dtype="float32")
        np.savez_compressed(folder / "emb_bge-small.npz", meta=json.dumps({"backend": "bge", "p50_ms": 7.0, "p95_ms": 9.0, "peak_rss_gb": 0.5}), d384=eye, q384=eye)
        np.savez_compressed(folder / "emb_eg2-asym.npz", meta=json.dumps({"backend": "st", "p50_ms": 40.0, "p95_ms": 60.0, "peak_rss_gb": 2.0, "q_prompt": "SearchQuery", "d_prompt": "Document"}), d768=eye, q768=eye, d256=eye, q256=eye)
        variants, metas = B.load_embedders(folder)
        check("each embedder file becomes a variant per dimension: bge-small, eg2-asym@768, eg2-asym@256; and each file's meta is kept", sorted(variants) == ["bge-small", "eg2-asym@256", "eg2-asym@768"] and set(metas) == {"bge-small", "eg2-asym"}, sorted(variants))
        check("the matrices are read as they were written", np.array_equal(variants["eg2-asym@768"]["docs"], eye))
    saved = B.BAKE
    with tempfile.TemporaryDirectory() as folder:
        B.BAKE = Path(folder)
        try:
            counts = B.prepare()
            texts = json.loads((Path(folder) / "texts.json").read_text())
            check("prepare writes the unique decision texts of the test and development series (405) and every statement (396) with its probe id", counts == {"docs": 405, "queries": 396} and len(texts["query_ids"]) == 396 and len(set(texts["docs"])) == 405)
        finally:
            B.BAKE = saved


def text_checks() -> None:
    def x(found: int) -> dict:
        return {"n": 168, "found": {4: found, 8: found, 12: found}, "found_text": {4: found, 8: found, 12: found}}
    rows = lambda a, b: {"bm25": x(a), "good dense": x(b)}
    none = {"test": {c: rows(100, 120) for c in B.CONDITIONS}, "dev": {c: {k: {"n": 30, "found": {4: 20, 8: 25, 12: 28}} for k in ("bm25", "good dense")} for c in B.CONDITIONS}}
    metas = {"good": {"backend": "st", "p50_ms": 41.2, "p95_ms": 60.0, "peak_rss_gb": 1.9, "q_prompt": "SearchQuery", "d_prompt": "Document"}}
    text = B.describe(none, metas)
    check("when no retriever reaches 95% the text says none is recall-safe, names the best and its percentages, and says a language-model run is not justified",
          "No retriever is recall-safe" in text and "The best at k = 8 is good dense: 71% in C2 and 71% in C3" in text and "not justified" in text, text[-900:])
    safe = {"test": {c: rows(100, 120) for c in ("C0", "C1")} | {c: {"bm25": x(100), "good dense": x(165)} for c in ("C2", "C3")}, "dev": none["dev"]}
    text2 = B.describe(safe, metas)
    check("when one does, the text names it and says a confirmation is justified", "Recall-safe: good dense" in text2 and "is justified" in text2 and "No retriever is recall-safe" not in text2, text2[-700:])
    check("the text gives the cost of one statement and the memory, the percentages of the table, and the warning that BM25 is favoured in C1 and C2",
          "41.2 ms" in text and "peak 1.9 GB" in text and "SearchQuery/Document" in text and "BM25 is favoured in C1 and C2" in text and "60%" in text)
    check("the post-hoc block says so, and says that no retriever would pass counted that way (71% here), or which would", "POST-HOC" in text and "Not the pre-registered metric" in text and "no retriever would pass the rule either" in text and "good dense would pass the rule" in text2, text[-1400:])


def main() -> int:
    c = B.corpus()
    memories_checks(c)
    recall_checks()
    evaluate_checks(c)
    rule_checks()
    files_checks()
    text_checks()
    print(f"All {len(passed)} bake-off checks passed: the memories, the recall, the pre-registered rule and the text.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
