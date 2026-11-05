"""Optional cloud comparison: the same evaluation with a cloud model served through OpenRouter.

Used ONLY on public data (AMI, CC BY 4.0) and the fictional demo series, never on private meetings.
Guard rails: pinned provider, no fallbacks, providers that train on prompts are excluded, temperature 0, every call cached,
a hard spending cap read from the usage cost OpenRouter reports, key only from the environment (never written anywhere).
"""
import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

from memoria_engine.extractors import MLXExtractor

URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash"
DEFAULT_PROVIDER = "DeepInfra"


class SpendCapReached(RuntimeError):
    pass


class CachingOpenRouter(MLXExtractor):
    def __init__(self, cache_path: str, model_id: str = None, max_tokens: int = 900) -> None:
        model_id = model_id or os.environ.get("MEMORIA_CLOUD_MODEL", DEFAULT_MODEL)
        super().__init__(model_id, max_tokens)
        self.provider = os.environ.get("MEMORIA_CLOUD_PROVIDER", DEFAULT_PROVIDER)
        self.cap_usd = float(os.environ.get("MEMORIA_CLOUD_CAP_USD", "1.0"))
        self.cache_path = Path(cache_path)
        self.hits = self.misses = 0
        self.spent = 0.0
        self._cache: Dict[str, Dict[str, Any]] = {}
        if self.cache_path.exists():
            for line in self.cache_path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    record = json.loads(line)
                    self._cache[record["key"]] = record
                    self.spent += float(record.get("cost_usd") or 0.0)
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> None:
        if not os.environ.get("OPENROUTER_API_KEY"):
            raise SystemExit("OPENROUTER_API_KEY is not set (export it in this shell only; it is never stored)")

    def _key(self, prompt: str, max_tokens: int) -> str:
        return hashlib.sha256(f"{self.model_id}|{self.provider}\n{max_tokens}\n{prompt}".encode("utf-8")).hexdigest()

    def _post(self, body: Dict[str, Any]) -> Dict[str, Any]:
        req = urllib.request.Request(URL, data=json.dumps(body).encode(), method="POST", headers={
            "Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}", "Content-Type": "application/json", "X-Title": "Memoria FYP evaluation"})
        last = None
        for attempt in range(6):
            try:
                with urllib.request.urlopen(req, timeout=600) as resp:
                    return json.loads(resp.read())
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode(errors="replace")[:400]
                if exc.code in (429, 500, 502, 503, 504):
                    last = f"HTTP {exc.code}: {detail}"
                    time.sleep(2 ** attempt)
                    continue
                raise RuntimeError(f"OpenRouter HTTP {exc.code}: {detail}") from exc
            except (urllib.error.URLError, TimeoutError) as exc:
                last = str(exc)
                time.sleep(2 ** attempt)
        raise RuntimeError(f"OpenRouter failed after retries: {last}")

    def complete(self, prompt: str, max_tokens: Optional[int] = None) -> Dict[str, Any]:
        budget = max_tokens or self.max_tokens
        key = self._key(prompt, budget)
        hit = self._cache.get(key)
        if hit is not None:
            self.hits += 1
            return {"text": hit["text"], "seconds": hit["seconds"], "prompt_tokens": hit["prompt_tokens"], "output_tokens": hit["output_tokens"], "cached": True}
        if self.spent >= self.cap_usd:
            raise SpendCapReached(f"spent ${self.spent:.3f} >= cap ${self.cap_usd:.2f}; raise MEMORIA_CLOUD_CAP_USD to continue")
        body = {"model": self.model_id, "messages": [{"role": "user", "content": prompt}], "max_tokens": budget, "temperature": 0,
                "provider": {"order": [self.provider], "allow_fallbacks": False, "data_collection": "deny"},
                "reasoning": {"effort": "none"}, "usage": {"include": True}}
        started = time.perf_counter()
        try:
            reply = self._post(body)
        except RuntimeError as exc:
            if "reasoning" not in str(exc):
                raise
            body.pop("reasoning")
            reply = self._post(body)
        seconds = time.perf_counter() - started
        choice = reply["choices"][0]
        text = (choice.get("message", {}).get("content") or "").strip()
        usage = reply.get("usage", {})
        cost = float(usage.get("cost") or 0.0)
        record = {"key": key, "model": self.model_id, "provider": reply.get("provider") or self.provider, "max_tokens": budget, "prompt_head": prompt[:120], "text": text,
                  "seconds": seconds, "prompt_tokens": usage.get("prompt_tokens"), "output_tokens": usage.get("completion_tokens"), "cost_usd": cost,
                  "finish_reason": choice.get("finish_reason"), "recorded": time.strftime("%Y-%m-%d %H:%M:%S")}
        self._cache[key] = record
        with self.cache_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
        self.spent += cost
        self.misses += 1
        return {"text": text, "seconds": seconds, "prompt_tokens": usage.get("prompt_tokens"), "output_tokens": usage.get("completion_tokens"), "cached": False}
