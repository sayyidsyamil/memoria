"""Retriever bake-off for topic scoping: can a better retriever make the scope recall-safe?

The topic-scoping experiment (scoping.py) found that the scope, the four decisions nearest to a statement by bge-small, lost the decision a probe was
about in 7% of probes with 12 decisions in memory, 23% with 42 and 29% with 86, and that this, not the language model, explains the lost alerts. This
asks, WITHOUT any language model, which retriever keeps the right decision in the scope, so that a ~90-minute run of the auditor is spent only on one that could work.

RETRIEVERS   dense (cosine of normalised embeddings) for each embedder: bge-small-en-v1.5 (what M3 used); EmbeddingGemma 2 at full precision with its
             search prompts, with a symmetric similarity prompt, at 768 and at 256 dimensions; the 5-bit MLX conversion of the same model;
             BM25 on the decision text; and hybrid = reciprocal-rank fusion (k = 60) of a dense ranking and BM25.
CONDITIONS   the memory a statement is retrieved from, for the 28 test series (336 probes, 168 of them with a gold decision) and, as a second look,
             the 5 development series (60 probes, 30 with a gold decision), whose other-topic decisions come from the test series:
               C0, C1, C2  as in the scoping experiment (the other-topic decisions share no keyword attribute and no specific word with the series);
               C3          the series' decisions plus EVERY other series' decisions, unfiltered (the hardest case; it does not favour lexical retrieval).
             Label contamination does not matter for this question: it asks only whether the gold decision is in the top k.
METRIC       scope recall at k = 4, 8 and 12: of the probes with a gold decision, the share whose gold decision is among the k highest-ranked decisions.
PRE-REGISTERED RULE (written before any embedding was computed)
             A retriever is recall-safe if its scope recall at k = 8 is at least 0.95 on the test series in C2 AND in C3. Only a recall-safe retriever
             justifies a language-model confirmation (the same auditor reading its scope); if none is, the answer is that similarity scoping is not safe here.
             Speed (ms for one statement) and memory are reported beside it. Nothing is chosen on the test set: every retriever is reported.
NOT SHOWN    That a recall-safe scope keeps the auditor's accuracy; only the language-model run can say. BM25 is favoured in C1 and C2 because their
             other-topic decisions were chosen to share no word with the probes; C3 is the fair lexical test.

    python3.11 retriever_bakeoff.py prepare     writes results/scoping/bakeoff/texts.json (for embed_texts.py, which runs in the embedders' own venvs)
    python3.11 retriever_bakeoff.py analyse     reads the emb_*.npz files and writes bakeoff_results.json and bakeoff_summary.txt
"""

import json
import random
import sys
import time
from pathlib import Path

import numpy as np

import generate_bench as G
import run_scoping as RS
import scoping as S
import scoping_posthoc as H

BAKE = RS.OUT / "bakeoff"
KS = (4, 8, 12)
SAFE_RECALL, SAFE_K = 0.95, 8
CONDITIONS = ("C0", "C1", "C2", "C3")


# --- the memories -----------------------------------------------------------------------------------------------

def unfiltered_memory(series: str, memories: dict[str, list[dict]]) -> list[dict]:
    """C3: the series' decisions and every other series' decisions, shuffled together. Nothing is filtered."""
    items = [{**i, "source": series} for i in memories[series]] + [{**i, "source": name} for name in sorted(memories) if name != series for i in memories[name]]
    random.Random(G.stable(S.SEED, "c3", series)).shuffle(items)
    return items


def condition_items(series: str, condition: str, memories: dict[str, list[dict]], statements: dict[str, list[str]], generic: set[str]) -> list[dict]:
    """The decisions a statement of this series is retrieved from, in one condition (C0 to C2 as in the scoping experiment, C3 unfiltered)."""
    if condition == "C3":
        return unfiltered_memory(series, memories)
    return S.parse_memory(S.build_memory(series, condition, memories, statements, generic)[0])


def corpus() -> dict:
    """Everything the bake-off reads: the own memories (test from the benchmark's cache, dev likewise), the statements, the probes, the generic stems."""
    test_memories, test_statements, test_probes = RS.load_split("test")
    dev_memories, dev_statements, dev_probes = RS.load_split("dev")
    return {"test": {"memories": test_memories, "statements": test_statements, "probes": test_probes},
            "dev": {"memories": dev_memories, "statements": dev_statements, "probes": dev_probes},
            "all_memories": {**dev_memories, **test_memories}}


def memories_for(split: str, c: dict, condition: str) -> dict[str, list[dict]]:
    """Per series of a split, the items of one condition. Test series are built from the test series alone (as in the scoping experiment, so C1 and C2
    are the files on disk); development series draw their other-topic decisions from the development and the test series."""
    own, statements = c[split]["memories"], c[split]["statements"]
    if split == "test":
        pool, generic = own, S.generic_stems([i["text"] for items in own.values() for i in items])
    else:
        pool, generic = c["all_memories"], S.generic_stems([i["text"] for items in c["all_memories"].values() for i in items])
    if condition == "C0":
        return {s: [dict(i) for i in own[s]] for s in own}
    return {s: condition_items(s, condition, pool, statements, generic) for s in own}


# --- the texts for the embedders ------------------------------------------------------------------------------------

def prepare() -> dict:
    c = corpus()
    docs = sorted({i["text"] for items in c["all_memories"].values() for i in items})
    probes = c["test"]["probes"] + c["dev"]["probes"]
    texts = {"docs": docs, "queries": [p["statement"] for p in probes], "query_ids": [p["id"] for p in probes]}
    BAKE.mkdir(parents=True, exist_ok=True)
    (BAKE / "texts.json").write_text(json.dumps(texts, ensure_ascii=False), encoding="utf-8")
    return {"docs": len(docs), "queries": len(texts["queries"])}


# --- retrieval ---------------------------------------------------------------------------------------------------

def recall_at(rankings: list[list[int]], probes: list[dict], items: dict[str, list[dict]], ks: tuple[int, ...] = KS) -> dict:
    """Of the probes with a gold decision, how many have it in the top k of their ranking (rankings[i] ranks the items of probes[i]'s series).
    "found" is the pre-registered count: the gold decision itself. "found_text" is a post-hoc count: a decision with the same words as the gold one
    (in C3 other groups wrote the same sentence, and a scope that holds one of those holds what the auditor needs, though not the gold id)."""
    found, found_text = {k: 0 for k in ks}, {k: 0 for k in ks}
    n = 0
    for probe, order in zip(probes, rankings):
        if not probe["gold_citation"]:
            continue
        n += 1
        wanted = probe["gold_citation"].strip("[]")
        series = items[probe["series_id"]]
        gold_text = next(i["text"] for i in series if i["id"] == wanted)
        ranked = [series[i] for i in order]
        for k in ks:
            found[k] += wanted in [i["id"] for i in ranked[:k]]
            found_text[k] += gold_text in [i["text"] for i in ranked[:k]]
    return {"n": n, "found": found, "found_text": found_text}


def rankings_for(method: str, probes: list[dict], items: dict[str, list[dict]], doc_vectors: dict[str, np.ndarray] | None, query_vectors: list[np.ndarray] | None) -> list[list[int]]:
    """For every probe, its series' items ranked best first by dense similarity, BM25 or their fusion."""
    out = []
    lexical_docs = {s: [H.tokens(i["text"]) for i in its] for s, its in items.items()}
    for n, probe in enumerate(probes):
        s = probe["series_id"]
        dense = H.ranking(doc_vectors[s] @ query_vectors[n]) if method in ("dense", "hybrid") else None
        lexical = H.ranking(H.bm25(H.tokens(probe["statement"]), lexical_docs[s])) if method in ("bm25", "hybrid") else None
        out.append(dense if method == "dense" else lexical if method == "bm25" else H.fuse(dense, lexical))
    return out


def bm25_timing(c: dict) -> dict:
    """Median and 95th-percentile time to score one statement against its series' memory with BM25 (the memory is tokenised once, as an index would be), on the test series."""
    out = {}
    for condition in ("C2", "C3"):
        items = memories_for("test", c, condition)
        docs = {s: [H.tokens(i["text"]) for i in its] for s, its in items.items()}
        times = []
        for probe in c["test"]["probes"]:
            start = time.perf_counter()
            H.ranking(H.bm25(H.tokens(probe["statement"]), docs[probe["series_id"]]))
            times.append((time.perf_counter() - start) * 1000)
        out[condition] = {"p50_ms": float(np.median(times)), "p95_ms": float(np.percentile(times, 95)), "decisions_p50": float(np.median([len(v) for v in items.values()])), "statements": len(times)}
    return out


def evaluate(c: dict, embedders: dict[str, dict], doc_index: dict[str, int], query_index: dict[str, int]) -> dict:
    """{split: {condition: {retriever: recall}}} for every embedder variant and for BM25 alone."""
    result = {}
    for split in ("test", "dev"):
        probes = c[split]["probes"]
        result[split] = {}
        for condition in CONDITIONS:
            items = memories_for(split, c, condition)
            row = {"bm25": recall_at(rankings_for("bm25", probes, items, None, None), probes, items)}
            for name, e in embedders.items():
                docs = {s: e["docs"][[doc_index[i["text"]] for i in its]] for s, its in items.items()}
                queries = [e["queries"][query_index[p["id"]]] for p in probes]
                row[f"{name} dense"] = recall_at(rankings_for("dense", probes, items, docs, queries), probes, items)
                row[f"{name} hybrid"] = recall_at(rankings_for("hybrid", probes, items, docs, queries), probes, items)
            result[split][condition] = row
    return result


def load_embedders(folder: Path) -> tuple[dict[str, dict], dict[str, dict]]:
    """Every emb_*.npz becomes one variant per dimension it holds: {name@dim: {"docs", "queries"}} and each file's meta."""
    variants, metas = {}, {}
    for path in sorted(folder.glob("emb_*.npz")):
        z = np.load(path, allow_pickle=False)
        meta = json.loads(str(z["meta"]))
        base = path.stem.removeprefix("emb_")
        metas[base] = meta
        for dim in (384, 768, 256):
            if f"d{dim}" in z.files:
                variants[f"{base}@{dim}" if base != "bge-small" else base] = {"docs": z[f"d{dim}"], "queries": z[f"q{dim}"], "meta": meta}
    return variants, metas


def recall_safe(result: dict, name: str, k: int = SAFE_K) -> bool:
    """The pre-registered rule: recall at k = 8 of at least 0.95 on the test series in C2 and in C3."""
    return all(x["found"][k] / x["n"] >= SAFE_RECALL - 1e-12 for x in (result["test"]["C2"][name], result["test"]["C3"][name]))


# --- saying it ---------------------------------------------------------------------------------------------------

def describe(result: dict, metas: dict[str, dict]) -> str:
    names = list(result["test"]["C0"])
    out = ["RETRIEVER BAKE-OFF FOR TOPIC SCOPING", "=" * 38, "",
           "Scope recall = of the probes that have a gold decision, the share whose gold decision is among the k highest-ranked decisions. No language model is involved.", ""]
    for split, title in (("test", "TEST SERIES (168 probes with a gold decision)"), ("dev", "DEVELOPMENT SERIES (30 probes with a gold decision; a second look, noisy)")):
        out += [title, "-" * len(title), f"{'retriever':<30}" + "".join(f"{c + ' k=' + str(k):>9}" for c in CONDITIONS for k in (4, 8))]
        for name in names:
            cells = []
            for c in CONDITIONS:
                x = result[split][c][name]
                cells += [f"{100 * x['found'][k] / x['n']:>8.0f}%" for k in (4, 8)]
            out.append(f"{name:<30}" + "".join(cells))
        out.append("")
    safe = [n for n in names if recall_safe(result, n)]
    out += ["PRE-REGISTERED RULE: recall at k = 8 of at least 95% on the test series in C2 and in C3", "-" * 62]
    best8 = max(names, key=lambda n: (result["test"]["C3"][n]["found"][8], result["test"]["C2"][n]["found"][8]))
    if safe:
        out.append("Recall-safe: " + ", ".join(safe) + ". A language-model confirmation of the scope of the best of these is justified.")
    else:
        x2, x3 = result["test"]["C2"][best8], result["test"]["C3"][best8]
        out.append(f"No retriever is recall-safe. The best at k = 8 is {best8}: {100 * x2['found'][8] / x2['n']:.0f}% in C2 and {100 * x3['found'][8] / x3['n']:.0f}% in C3. "
                   "Similarity scoping would still lose the right decision too often; a language-model run of it is not justified by this.")
    out += ["", "POST-HOC: A HIT WHEN THE SCOPE HOLDS A DECISION WITH THE SAME WORDS AS THE GOLD ONE (test series)", "-" * 62,
            "In C3 other groups wrote the same sentence, so a scope can hold what the auditor needs without holding the gold id. Not the pre-registered metric.",
            f"{'retriever':<30}" + "".join(f"{c + ' k=' + str(k):>9}" for c, k in (("C2", 8), ("C3", 4), ("C3", 8), ("C3", 12)))]
    for name in names:
        out.append(f"{name:<30}" + "".join(f"{100 * result['test'][c][name]['found_text'][k] / result['test'][c][name]['n']:>8.0f}%" for c, k in (("C2", 8), ("C3", 4), ("C3", 8), ("C3", 12))))
    best_text = max(names, key=lambda n: (result["test"]["C3"][n]["found_text"][8], result["test"]["C2"][n]["found_text"][8]))
    t2, t3 = result["test"]["C2"][best_text], result["test"]["C3"][best_text]
    text_safe = [n for n in names if all(result["test"][c][n]["found_text"][8] / result["test"][c][n]["n"] >= SAFE_RECALL - 1e-12 for c in ("C2", "C3"))]
    out.append("Counted this way " + (f"{', '.join(text_safe)} would pass the rule." if text_safe else
                                      f"no retriever would pass the rule either: the best at k = 8 is {best_text}, {100 * t2['found_text'][8] / t2['n']:.0f}% in C2 and {100 * t3['found_text'][8] / t3['n']:.0f}% in C3."))
    out += ["", "COST OF ONE STATEMENT (embedding step, median over 30 statements) AND MEMORY OF THE EMBEDDER PROCESS", "-" * 62]
    for base, m in metas.items():
        out.append(f"{base:<26} {m['p50_ms']:>7.1f} ms (P95 {m['p95_ms']:.1f}), peak {m.get('mlx_peak_gb') or m['peak_rss_gb']} GB ({m['backend']}{', prompts ' + str(m.get('q_prompt')) + '/' + str(m.get('d_prompt')) if m.get('q_prompt') else ''})")
    out += ["", "READING THIS", "-" * 62,
            "- BM25 is favoured in C1 and C2: their other-topic decisions were chosen to share no word with the probes. C3 keeps every other decision, so it is the fair test of a lexical or hybrid retriever.",
            "- C3 is a harder memory than any real project's (it is made of the same product's decisions by 27 other groups): a result there is a stress test.",
            "- Scope recall is necessary, not sufficient: it says nothing about what the auditor does with a good scope.", ""]
    return "\n".join(out)


def analyse() -> dict:
    c = corpus()
    texts = json.loads((BAKE / "texts.json").read_text(encoding="utf-8"))
    doc_index = {t: i for i, t in enumerate(texts["docs"])}
    query_index = {q: i for i, q in enumerate(texts["query_ids"])}
    variants, metas = load_embedders(BAKE)
    result = evaluate(c, variants, doc_index, query_index)
    timing = bm25_timing(c)
    (BAKE / "bakeoff_results.json").write_text(json.dumps({"result": result, "meta": metas, "rule": {"k": SAFE_K, "recall": SAFE_RECALL}, "bm25_ms": timing}, indent=1, default=str), encoding="utf-8")
    text = describe(result, metas) + "\nBM25 TIME FOR ONE STATEMENT (the memory tokenised once): " + ", ".join(f"{k} ({v['decisions_p50']:.0f} decisions) {v['p50_ms']:.2f} ms median, {v['p95_ms']:.2f} ms 95th percentile" for k, v in timing.items()) + "\n"
    (BAKE / "bakeoff_summary.txt").write_text(text, encoding="utf-8")
    return {"result": result, "text": text}


def main(argv: list[str]) -> int:
    if not argv or argv[0] not in ("prepare", "analyse"):
        print(__doc__)
        return 2
    if argv[0] == "prepare":
        print(json.dumps(prepare()))
        return 0
    print(analyse()["text"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
