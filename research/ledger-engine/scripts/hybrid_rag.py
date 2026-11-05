"""Dense + BM25 transcript RAG, with weighted reciprocal-rank fusion.

No gold event, answer, slot id or annotation is used for retrieval. The generator
and answer parser are the existing v3 baseline's, so the intervention is retrieval.
Embeddings run on CPU and are cached before loading the MLX generator.
"""
from __future__ import annotations

import hashlib
import json
import math
import time
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Sequence

from memoria_engine.evaluation import baselines

BGE_MODEL = "BAAI/bge-small-en-v1.5"
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


@dataclass(frozen=True)
class RetrievalConfig:
    k: int = 12
    window: int = 3
    alpha: float = 0.5
    rrf: int = 60
    candidates: int = 50

    def __post_init__(self):
        if self.k < 1 or self.window < 1 or self.rrf < 1 or self.candidates < self.k:
            raise ValueError("positive k/window/rrf required; candidates must be >= k")
        if not 0 <= self.alpha <= 1:
            raise ValueError("alpha must be between zero (BM25) and one (dense)")

    @property
    def name(self):
        return f"hybrid-k{self.k}-w{self.window}-a{self.alpha:g}-r{self.rrf}-c{self.candidates}"


def bm25_scores(documents: Sequence[str], query: str) -> list[float]:
    docs = [baselines.tokens(d) for d in documents]
    avg = sum(map(len, docs)) / max(1, len(docs))
    df = Counter(w for d in docs for w in set(d))
    words = set(baselines.tokens(query))
    scores = []
    for doc in docs:
        tf = Counter(doc)
        scores.append(sum(math.log(1 + (len(docs) - df[w] + 0.5) / (df[w] + 0.5))
                          * tf[w] * 2.5 / (tf[w] + 1.5 * (0.25 + 0.75 * len(doc) / avg))
                          for w in words if w in tf))
    return scores


def fused_ranking(lexical: Sequence[float], dense: Sequence[float], config: RetrievalConfig) -> list[dict]:
    """One-based ranks; alpha weights dense. Zero lexical scores contribute nothing.

    Ties are resolved by corpus position, never by gold. Select by relevance, then
    present the selected passages chronologically (as in the existing baseline).
    """
    if len(lexical) != len(dense) or not all(math.isfinite(float(s)) for s in (*lexical, *dense)):
        raise ValueError("finite, equally sized lexical and dense scores required")
    lex = sorted(range(len(lexical)), key=lambda i: (-lexical[i], i))[:config.candidates]
    sem = sorted(range(len(dense)), key=lambda i: (-dense[i], i))[:config.candidates]
    lr = {i: rank for rank, i in enumerate(lex, 1) if lexical[i] > 0}
    dr = {i: rank for rank, i in enumerate(sem, 1)}
    scores = {i: (1 - config.alpha) / (config.rrf + lr[i]) for i in lr if config.alpha < 1}
    for i in dr if config.alpha > 0 else ():
        scores[i] = scores.get(i, 0) + config.alpha / (config.rrf + dr[i])
    ranked = sorted(scores, key=lambda i: (-scores[i], i))[:config.k]
    return [{"index": i, "score": scores[i], "bm25_rank": lr.get(i), "dense_rank": dr.get(i)} for i in ranked]


class BGEEncoder:
    """Actual pretrained CLS embeddings, normalised for cosine similarity.

    A content-addressed disk cache includes the model commit, prefix and token
    limit. No hashing/TF-IDF approximation is substituted for dense embeddings.
    """
    def __init__(self, cache: Path, model: str = BGE_MODEL, local_only: bool = True):
        import torch
        from transformers import AutoModel, AutoTokenizer

        torch.set_num_threads(4)
        self.torch = torch
        self.tokenizer = AutoTokenizer.from_pretrained(model, local_files_only=local_only)
        self.model = AutoModel.from_pretrained(model, local_files_only=local_only).eval().to("cpu")
        self.identity = {"model": model, "revision": getattr(self.model.config, "_commit_hash", None),
                         "pooling": "CLS", "max_tokens": 512, "query_prefix": QUERY_PREFIX}
        self.cache = Path(cache)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.hits = self.misses = 0

    def encode(self, texts: Sequence[str], query: bool = False):
        import numpy as np

        strings = [QUERY_PREFIX + t if query else t for t in texts]
        vectors = [None] * len(strings)
        pending = {}
        for i, text in enumerate(strings):
            key = hashlib.sha256((json.dumps(self.identity, sort_keys=True) + "\n" + text).encode()).hexdigest()
            path = self.cache / f"{key}.npy"
            if path.exists():
                vectors[i] = np.load(path, allow_pickle=False)
                self.hits += 1
            else:
                pending.setdefault(key, {"text": text, "positions": []})["positions"].append(i)
        keys = list(pending)
        with self.torch.inference_mode():
            for start in range(0, len(keys), 32):
                batch = keys[start:start + 32]
                encoded = self.tokenizer([pending[key]["text"] for key in batch], padding=True,
                                         truncation=True, max_length=512, return_tensors="pt")
                output = self.model(**encoded).last_hidden_state[:, 0]
                output = self.torch.nn.functional.normalize(output, dim=-1).cpu().numpy().astype("float32")
                for key, vector in zip(batch, output):
                    np.save(self.cache / f"{key}.npy", vector, allow_pickle=False)
                    for i in pending[key]["positions"]:
                        vectors[i] = vector
                    self.misses += 1
        return np.stack(vectors) if vectors else np.empty((0, self.model.config.hidden_size), dtype="float32")


class HybridRAG(baselines._System):
    def __init__(self, llm: Any, encoder: Any, config: RetrievalConfig = RetrievalConfig(), cot: bool = False):
        super().__init__(llm, cot=cot, version="v3")
        self.encoder, self.config = encoder, config
        self._indexes = {}
        self.last_retrieval = {}

    @property
    def name(self):
        return self.config.name + ("+cot" if self.cot else "")

    def retrieve(self, chain, q):
        started = time.perf_counter()
        chunks = baselines.BM25RAG(None, window=self.config.window)._chunks(chain, q)
        key = hashlib.sha256(json.dumps(chunks).encode()).hexdigest()
        if key not in self._indexes:
            # Include meeting date and speaker-labelled text in the semantic index.
            self._indexes[key] = self.encoder.encode([f"{src}\n{text}" for src, text in chunks])
        query = self.encoder.encode([baselines.nl_question(q)], query=True)
        dense = (self._indexes[key] @ query[0]).tolist()
        lexical = bm25_scores([text for _, text in chunks], baselines.nl_question(q))
        ranked = fused_ranking(lexical, dense, self.config)
        self.last_retrieval = {"seconds": time.perf_counter() - started, "corpus_chunks": len(chunks),
                               "selected": [{**r, "source": chunks[r["index"]][0], "text": chunks[r["index"]][1]} for r in ranked],
                               "config": asdict(self.config)}
        return [chunks[r["index"]] for r in sorted(ranked, key=lambda r: r["index"])]

    def prompt(self, chain, q):
        material = "\n\n".join(f"[{src}]\n{text}" for src, text in self.retrieve(chain, q))
        return baselines.prompt_v3(chain, q, material, self.cot, "meeting excerpts (retrieved passages, oldest first)")
