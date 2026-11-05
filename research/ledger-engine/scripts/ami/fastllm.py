"""Speed-only variant of CachingMLX for long full-context prompts: the shared prefix is prefilled once and reused.

Every baseline question about the same meetings has the same prompt up to the final "Question:" line, so the 30k-token
prefix is computed once per question family and only the short question and the answer are computed per call.
Decoding is greedy; outputs are meant to be identical to the plain path (checked by scripts/ami/check_fast_equivalence.py).
Nothing here changes what is asked or how answers are scored, and the file cache format and keys are unchanged.
"""
import copy
import time
from typing import Any, Dict, List, Optional

from memoria_engine.llmcache import CachingMLX

MARKER = "\n\nQuestion:"
MIN_PREFIX_TOKENS = 1500


def common_prefix(a: List[int], b: List[int]) -> int:
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    return i


class FastCachingMLX(CachingMLX):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._prefix_ids: List[int] = []
        self._prefix_cache: Any = None
        self.prefix_hits = self.prefix_builds = 0

    def _templated(self, prompt: str) -> str:
        messages = [{"role": "user", "content": prompt}]
        try:
            return self._tok.apply_chat_template(messages, add_generation_prompt=True, tokenize=False, enable_thinking=False)
        except TypeError:
            return self._tok.apply_chat_template(messages, add_generation_prompt=True, tokenize=False)

    def _encode(self, text: str) -> List[int]:
        bos = getattr(self._tok, "bos_token", None)
        return list(self._tok.encode(text, add_special_tokens=bos is None or not text.startswith(bos)))

    def _prefix_boundary(self, text: str, ids: List[int]) -> int:
        cut = text.rfind(MARKER)
        if cut < 0:
            return 0
        other = self._encode(text[:cut] + MARKER + " ?")
        return common_prefix(ids, other)

    def _generate(self, ids: List[int], max_tokens: int, cache: Any) -> str:
        from mlx_lm import generate

        return generate(self._model, self._tok, prompt=ids, max_tokens=max_tokens, verbose=False, prompt_cache=cache)

    def _fresh_prefix(self, ids: List[int], boundary: int) -> None:
        import mlx.core as mx
        from mlx_lm.generate import stream_generate
        from mlx_lm.models.cache import make_prompt_cache

        cache = make_prompt_cache(self._model)
        for _ in stream_generate(self._model, self._tok, prompt=mx.array(ids[:boundary]), max_tokens=1, prompt_cache=cache):
            pass
        self._prefix_ids, self._prefix_cache = ids[:boundary], cache
        self.prefix_builds += 1

    def _raw_complete(self, prompt: str, max_tokens: int) -> Dict[str, Any]:
        self.load()
        text = self._templated(prompt)
        ids = self._encode(text)
        started = time.perf_counter()
        k = common_prefix(self._prefix_ids, ids)
        reusable = bool(self._prefix_ids) and k == len(self._prefix_ids)
        if not reusable:
            boundary = self._prefix_boundary(text, ids)
            if boundary < MIN_PREFIX_TOKENS:
                out = self._generate(ids, max_tokens, None)
                return {"text": out, "seconds": time.perf_counter() - started, "prompt_tokens": len(ids), "output_tokens": len(self._tok.encode(out))}
            self._fresh_prefix(ids, boundary)
        else:
            self.prefix_hits += 1
        cache = copy.deepcopy(self._prefix_cache)
        out = self._generate(ids[len(self._prefix_ids):], max_tokens, cache)
        return {"text": out, "seconds": time.perf_counter() - started, "prompt_tokens": len(ids), "output_tokens": len(self._tok.encode(out))}

    def complete(self, prompt: str, max_tokens: Optional[int] = None) -> Dict[str, Any]:
        import json

        budget = max_tokens or self.max_tokens
        key = self._key(prompt, budget)
        hit = self._cache.get(key)
        if hit is not None:
            self.hits += 1
            return {"text": hit["text"], "seconds": hit["seconds"], "prompt_tokens": hit["prompt_tokens"], "output_tokens": hit["output_tokens"], "cached": True}
        out = self._raw_complete(prompt, budget)
        record = {"key": key, "model": self.model_id, "max_tokens": budget, "prompt_head": prompt[:120], "text": out["text"], "seconds": out["seconds"],
                  "prompt_tokens": out["prompt_tokens"], "output_tokens": out["output_tokens"], "recorded": time.strftime("%Y-%m-%d %H:%M:%S"), "fast_prefix": True}
        self._cache[key] = record
        with self.cache_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
        self.misses += 1
        return {**{k: out[k] for k in ("text", "seconds", "prompt_tokens", "output_tokens")}, "cached": False}
