"""A recording wrapper around the local LLM: every call is stored and an identical prompt is replayed from the file.

Decoding is greedy, so replaying is lossless. It makes long evaluations resumable and leaves an audit trail
(prompt hash, output, token counts and the generation time measured when the call was first made).
Use one cache file per process; two processes appending to one file could interleave lines.
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any, Dict, Optional

from .extractors import MLXExtractor


class CachingMLX(MLXExtractor):
    def __init__(self, cache_path: str, model_id: str = "mlx-community/Qwen3.5-4B-MLX-4bit", max_tokens: int = 900) -> None:
        super().__init__(model_id, max_tokens)
        self.cache_path = Path(cache_path)
        self.hits = self.misses = 0
        self._cache: Dict[str, Dict[str, Any]] = {}
        self.skipped_lines: list = []
        if self.cache_path.exists():
            text = self.cache_path.read_text(encoding="utf-8")
            for number, line in enumerate(text.split("\n"), 1):
                if not line.strip():
                    continue
                try:
                    record = json.loads(line)
                    self._cache[record["key"]] = record
                except (json.JSONDecodeError, KeyError, TypeError):
                    # a crash can leave a half-written last line; the call is simply made again
                    self.skipped_lines.append(number)
            if text and not text.endswith("\n"):
                with self.cache_path.open("a", encoding="utf-8") as fh:
                    fh.write("\n")
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)

    def _key(self, prompt: str, max_tokens: int) -> str:
        return hashlib.sha256(f"{self.model_id}\n{max_tokens}\n{prompt}".encode("utf-8")).hexdigest()

    def complete(self, prompt: str, max_tokens: Optional[int] = None) -> Dict[str, Any]:
        budget = max_tokens or self.max_tokens
        key = self._key(prompt, budget)
        hit = self._cache.get(key)
        if hit is not None:
            self.hits += 1
            return {"text": hit["text"], "seconds": hit["seconds"], "prompt_tokens": hit["prompt_tokens"],
                    "output_tokens": hit["output_tokens"], "cached": True}
        out = super().complete(prompt, budget)
        record = {"key": key, "model": self.model_id, "max_tokens": budget, "prompt_head": prompt[:120], "text": out["text"],
                  "seconds": out["seconds"], "prompt_tokens": out["prompt_tokens"], "output_tokens": out["output_tokens"],
                  "recorded": time.strftime("%Y-%m-%d %H:%M:%S")}
        self._cache[key] = record
        with self.cache_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
        self.misses += 1
        return {**{k: out[k] for k in ("text", "seconds", "prompt_tokens", "output_tokens")}, "cached": False}
