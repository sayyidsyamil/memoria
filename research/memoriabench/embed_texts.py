"""Embed the texts of the retriever bake-off with one backend. Standalone: it needs only numpy and the backend's own library, so it can run in a venv of its own.

    python embed_texts.py --backend bge  --texts texts.json --out emb_bge-small.npz
    python embed_texts.py --backend st   --texts texts.json --out emb_eg2-asym.npz --q-prompt SearchQuery --d-prompt Document
    python embed_texts.py --backend mlx  --texts texts.json --out emb_eg2-5bit-asym.npz --q-prompt SearchQuery --d-prompt Document

texts.json holds {"docs": [...], "queries": [...]}. The output holds L2-normalised float32 matrices d768, q768 (d384, q384 for bge) and, for the
EmbeddingGemma models, the first 256 dimensions re-normalised (d256, q256), plus "meta" (a JSON string): the backend, the prompts, the time of one
single-text encode (P50 and P95 over 30 queries, in ms) and the peak memory of the process.
"""

import argparse
import json
import os
import resource
import sys
import time

import numpy as np


def normalise(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype="float32")
    n = np.linalg.norm(x, axis=-1, keepdims=True)
    n[n == 0] = 1
    return x / n


def truncate(x: np.ndarray, dim: int) -> np.ndarray:
    return normalise(x[:, :dim])


def timing(encode_one, queries: list[str]) -> dict:
    encode_one(queries[0])
    spent = []
    for q in queries[:30]:
        started = time.perf_counter()
        encode_one(q)
        spent.append((time.perf_counter() - started) * 1000)
    return {"p50_ms": float(np.percentile(spent, 50)), "p95_ms": float(np.percentile(spent, 95))}


def run_bge(args, texts) -> tuple[dict, dict]:
    import torch
    from transformers import AutoModel, AutoTokenizer

    name = args.model or "BAAI/bge-small-en-v1.5"
    tokenizer, model = AutoTokenizer.from_pretrained(name), AutoModel.from_pretrained(name).eval()

    def encode(batch: list[str]) -> np.ndarray:
        out = []
        with torch.no_grad():
            for i in range(0, len(batch), 64):
                enc = tokenizer(batch[i:i + 64], padding=True, truncation=True, max_length=256, return_tensors="pt")
                out.append(torch.nn.functional.normalize(model(**enc).last_hidden_state[:, 0], dim=-1).numpy())
        return np.concatenate(out).astype("float32")

    prefix = args.q_prefix or ""
    arrays = {"d384": encode(texts["docs"]), "q384": encode([prefix + q for q in texts["queries"]])}
    return arrays, {"model": name, "q_prefix": prefix, **timing(lambda q: encode([prefix + q]), texts["queries"])}


def run_st(args, texts) -> tuple[dict, dict]:
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(args.model or "google/embeddinggemma-2", device="cpu")
    prompts = dict(getattr(model, "prompts", {}) or {})
    print("prompts available:", json.dumps(prompts)[:600], file=sys.stderr)
    kw = lambda name: {"prompt_name": name} if name else {}
    docs = model.encode(texts["docs"], batch_size=32, normalize_embeddings=True, convert_to_numpy=True, **kw(args.d_prompt))
    queries = model.encode(texts["queries"], batch_size=32, normalize_embeddings=True, convert_to_numpy=True, **kw(args.q_prompt))
    arrays = {"d768": normalise(docs), "q768": normalise(queries), "d256": truncate(docs, 256), "q256": truncate(queries, 256)}
    meta = {"model": args.model or "google/embeddinggemma-2", "q_prompt": args.q_prompt, "d_prompt": args.d_prompt, "prompts": prompts, **timing(lambda q: model.encode([q], normalize_embeddings=True, **kw(args.q_prompt)), texts["queries"])}
    return arrays, meta


def run_mlx(args, texts) -> tuple[dict, dict]:
    import mlx.core as mx
    from mlx_vlm.embedding_loader import load_embedding_model
    from mlx_vlm.utils import get_model_path
    from transformers import AutoTokenizer

    repo = args.model or "mlx-community/embeddinggemma-2-5bit"
    path = get_model_path(repo)
    model = load_embedding_model(path)
    tokenizer = AutoTokenizer.from_pretrained(path)
    prompts = {}
    config = os.path.join(str(path), "config_sentence_transformers.json")
    if os.path.exists(config):
        prompts = json.load(open(config)).get("prompts", {})
    print("prompts available:", json.dumps(prompts)[:600], file=sys.stderr)
    q_prefix, d_prefix = prompts.get(args.q_prompt, ""), prompts.get(args.d_prompt, "")

    def encode(batch: list[str]) -> np.ndarray:
        out = []
        for i in range(0, len(batch), 16):
            enc = tokenizer(batch[i:i + 16], padding=True, truncation=True, max_length=512, return_tensors="np")
            e = model(**{k: mx.array(v) for k, v in enc.items()}).text_embeds
            mx.eval(e)
            out.append(np.array(e.astype(mx.float32)))
        return np.concatenate(out)

    docs = encode([d_prefix + d for d in texts["docs"]])
    queries = encode([q_prefix + q for q in texts["queries"]])
    arrays = {"d768": normalise(docs), "q768": normalise(queries), "d256": truncate(docs, 256), "q256": truncate(queries, 256)}
    peak = float(mx.get_peak_memory()) / 1e9 if hasattr(mx, "get_peak_memory") else None
    meta = {"model": repo, "q_prefix": q_prefix, "d_prefix": d_prefix, "mlx_peak_gb": peak, **timing(lambda q: encode([q_prefix + q]), texts["queries"])}
    return arrays, meta


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=("bge", "st", "mlx"), required=True)
    parser.add_argument("--texts", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--model")
    parser.add_argument("--q-prompt")
    parser.add_argument("--d-prompt")
    parser.add_argument("--q-prefix")
    args = parser.parse_args(argv)
    texts = json.load(open(args.texts, encoding="utf-8"))
    started = time.time()
    arrays, meta = {"bge": run_bge, "st": run_st, "mlx": run_mlx}[args.backend](args, texts)
    meta.update({"backend": args.backend, "docs": len(texts["docs"]), "queries": len(texts["queries"]), "seconds": round(time.time() - started, 1),
                 "peak_rss_gb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9, 3)})
    np.savez_compressed(args.out, meta=json.dumps(meta), **arrays)
    print(json.dumps(meta, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
