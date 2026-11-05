"""Side check for the retriever bake-off: does a retriever still find the right decision when the statement is in Malay?

56 English probe statements (every third probe with a gold decision) were translated into Malay ('pure') and into the mixed English-Malay people speak
('mixed') by the assistant; the decisions stay in English. For bge-small-en-v1.5 and for EmbeddingGemma 2 (5-bit MLX, search prompts) this counts how often
the gold decision is the nearest decision (k = 1) or among the four nearest (k = 4), in the series' own memory (C0) and in the 86-decision memory (C2).
A small sample written by one person: a hint about languages, not a benchmark.

    python3.11 bakeoff_malay.py      (after embed_texts.py has written malay_emb_*.npz)
"""

import json
import sys

import numpy as np

import retriever_bakeoff as B

KS = (1, 4)


def main() -> int:
    c = B.corpus()
    folder = B.BAKE
    texts = json.loads((folder / "texts.json").read_text(encoding="utf-8"))
    doc_index = {t: i for i, t in enumerate(texts["docs"])}
    query_index = {q: i for i, q in enumerate(texts["query_ids"])}
    malay = json.loads((folder / "malay_probes.json").read_text(encoding="utf-8"))
    ids = malay["ids"]
    by_id = {p["id"]: p for p in c["test"]["probes"]}
    probes = [by_id[i] for i in ids]
    out = {"n": len(ids), "results": {}}
    for name, english_file, malay_file in (("bge-small", "emb_bge-small.npz", "malay_emb_bge-small.npz"), ("eg2-5bit", "emb_eg2-5bit-asym.npz", "malay_emb_eg2-5bit-asym.npz")):
        en, ml = np.load(folder / english_file), np.load(folder / malay_file)
        dim = "d384" if name == "bge-small" else "d768"
        q_key = "q384" if name == "bge-small" else "q768"
        docs_matrix, english_queries = en[dim], en[q_key]
        malay_docs = ml[dim]
        assert np.allclose(docs_matrix, malay_docs, atol=1e-5), "the document vectors of the two runs differ"
        sets = {"English": [english_queries[query_index[i]] for i in ids], "Malay": list(ml[q_key][: len(ids)]), "Malay-English mixed": list(ml[q_key][len(ids):])}
        for condition in ("C0", "C2"):
            items = B.memories_for("test", c, condition)
            docs = {s: docs_matrix[[doc_index[i["text"]] for i in its]] for s, its in items.items()}
            for language, vectors in sets.items():
                r = B.recall_at(B.rankings_for("dense", probes, items, docs, vectors), probes, items, ks=KS)
                out["results"][f"{name} | {condition} | {language}"] = {k: r["found"][k] for k in KS} | {"n": r["n"]}
    lines = ["MALAY SIDE CHECK", "=" * 17, "", f"{len(ids)} probes with a gold decision; dense retrieval; the decisions are in English.", "",
             f"{'embedder':<12}{'memory':<8}{'statement language':<22}{'nearest':>9}{'in top 4':>10}"]
    for key, v in out["results"].items():
        name, condition, language = key.split(" | ")
        lines.append(f"{name:<12}{condition:<8}{language:<22}{100 * v[1] / v['n']:>8.0f}%{100 * v[4] / v['n']:>9.0f}%")
    lines += ["", "The statements were translated by the assistant: a small sample, not a benchmark.", ""]
    text = "\n".join(lines)
    (folder / "malay_summary.txt").write_text(text, encoding="utf-8")
    (folder / "malay_results.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
