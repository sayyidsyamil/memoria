"""The only new code in the method: the model call.

`CachingOpenRouter` is a drop-in for the October `memoria_engine.llmcache.CachingMLX`: `complete(prompt, max_tokens)` returns
text, seconds, prompt_tokens and output_tokens, and `extract()` is inherited unchanged from `MLXExtractor` (October prompt
v2, October parser). Only the model behind `complete()` changes: one user message, greedy decoding, the same max_tokens.

Cost control:
* every response is cached in a jsonl keyed by the sha256 of the request body, so a request is never paid twice;
* every paid call is appended to spend.jsonl with its cost (OpenRouter `usage.cost`) and the running total;
* before a call is made, its worst case (whole prompt at the input price, every allowed output token) must fit under CAP_USD;
* a failed call is retried once, then written to failures.jsonl (not to the cache) and returned as an empty answer.
The API key is read from a file when needed and only ever placed in the Authorization header.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

HERE = Path(__file__).resolve().parent
LEDGER = HERE.parent / "ledger-engine"
sys.path.insert(0, str(LEDGER))

from memoria_engine.extractors import MLXExtractor  # noqa: E402

MODEL = "deepseek/deepseek-v4.1-flash-1017"
URL = "https://openrouter.ai/api/v1/chat/completions"
KEY_URL = "https://openrouter.ai/api/v1/key"
KEY_FILE = Path(os.environ.get("OPENROUTER_KEY_FILE", "/private/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode/openrouter.key"))
SETTINGS: Dict[str, Any] = {
    "temperature": 0,  # October decoded greedily
    "reasoning": {"effort": "none"},  # on by default for this model (effort high); October ran Qwen with thinking off
    # one serving endpoint for every call: StreamLake (fp8), same list price as the first-party DeepSeek endpoint,
    # which was degraded when the runs were made (OpenRouter uptime 0% last 5 min, 57% last day)
    "provider": {"order": ["streamlake"], "allow_fallbacks": False, "require_parameters": True},
    "usage": {"include": True},
}
PRICE = {"input": 0.15e-6, "output": 0.60e-6, "cached": 0.003e-6}  # USD per token, list price of the pinned endpoint
CAP_USD = 0.90
TIMEOUT_S = 300
CHARS_PER_TOKEN_FLOOR = 3.0  # pessimistic tokenisation for the pre-call worst case
SPEND = HERE / "spend.jsonl"
FAILURES = HERE / "failures.jsonl"


class BudgetStop(RuntimeError):
    pass


def _auth() -> Dict[str, str]:
    return {"Authorization": "Bearer " + KEY_FILE.read_text(encoding="utf-8").strip()}


def key_status() -> Dict[str, Any]:
    """Spend and limit of the key, never the key itself (the label can echo part of it, so it is dropped)."""
    r = requests.get(KEY_URL, headers=_auth(), timeout=30)
    r.raise_for_status()
    data = r.json().get("data", {})
    return {k: data.get(k) for k in ("usage", "limit", "limit_remaining")}


def _log_spend(entry: Dict[str, Any]) -> None:
    with SPEND.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry) + "\n")


def spend_total() -> float:
    if not SPEND.exists():
        return 0.0
    return round(sum(json.loads(line).get("cost") or 0.0 for line in SPEND.read_text().splitlines() if line.strip()), 6)


def key_check(label: str) -> Dict[str, Any]:
    status = key_status()
    _log_spend({"time": time.strftime("%Y-%m-%d %H:%M:%S"), "kind": "key-check", "label": label, **status, "cost": 0.0,
                "total_usd": spend_total()})
    print(f"[key] {label}: usage ${status['usage']:.4f}, limit ${status['limit']}, remaining ${status['limit_remaining']:.4f}; "
          f"spend log ${spend_total():.4f}; cap ${CAP_USD}", flush=True)
    return status


def request_body(prompt: str, max_tokens: int, model: str = MODEL) -> Dict[str, Any]:
    """The October call as one chat request: the prompt as the single user message, the same output budget."""
    return {"model": model, "messages": [{"role": "user", "content": prompt}], "max_tokens": max_tokens, **SETTINGS}


def request_key(body: Dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def load_cache(path: Path) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                try:
                    record = json.loads(line)
                    out[record["key"]] = record
                except (json.JSONDecodeError, KeyError):
                    continue  # a half-written last line: that call is simply made again
    return out


class CachingOpenRouter(MLXExtractor):
    def __init__(self, cache_path: str, model_id: str = MODEL, max_tokens: int = 900, run: str = "", offline: bool = False) -> None:
        super().__init__(model_id, max_tokens)
        self.cache_path, self.run, self.offline = Path(cache_path), run, offline
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self._cache = load_cache(self.cache_path)
        self.hits = self.misses = 0
        self.calls: List[Dict[str, Any]] = []  # every request this run made or replayed, in order
        self.tag: Optional[str] = None  # the meeting being read, so costs can be summed per meeting
        self.paid = 0.0
        self._base: Optional[float] = None

    def load(self) -> None:  # hosted model: nothing to load
        return None

    def extract(self, ctx: Any) -> Any:
        self.tag = ctx.meeting.meeting_id
        try:
            return super().extract(ctx)
        finally:
            self.tag = None

    def body(self, prompt: str, max_tokens: int) -> Dict[str, Any]:
        return request_body(prompt, max_tokens, self.model_id)

    def complete(self, prompt: str, max_tokens: Optional[int] = None) -> Dict[str, Any]:
        budget = max_tokens or self.max_tokens
        body = self.body(prompt, budget)
        key = request_key(body)
        record = self._cache.get(key)
        hit = record is not None
        if hit:
            self.hits += 1
        elif self.offline:
            raise SystemExit("cache miss in an offline replay: this request was never sent")
        else:
            record = self._call(key, body, prompt, budget)
            if record.get("error"):
                self.calls.append({"key": key, "hit": False, "tag": self.tag, "failed": True})
                return {"text": "", "seconds": record["seconds"], "prompt_tokens": 0, "output_tokens": 0, "cached": False}
            self._cache[key] = record
            with self.cache_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(record) + "\n")
            self.misses += 1
        self.calls.append({"key": key, "hit": hit, "tag": self.tag})
        return {"text": record["text"], "seconds": record["seconds"], "prompt_tokens": record["prompt_tokens"],
                "output_tokens": record["output_tokens"], "cached": hit}

    # ---- the paid call ----------------------------------------------------------------------------

    def _guard(self, prompt: str, budget: int) -> None:
        if self._base is None:  # what the key had spent before this process paid for anything
            self._base = max(float(key_status()["usage"] or 0.0), spend_total())
        worst = len(prompt) / CHARS_PER_TOKEN_FLOOR * PRICE["input"] + budget * PRICE["output"]
        if self._base + self.paid + worst > CAP_USD:
            raise BudgetStop(f"budget stop: ${self._base + self.paid:.4f} spent, this call could cost ${worst:.4f}, cap ${CAP_USD}")

    def _charge(self, key: str, usage: Dict[str, Any], what: str) -> None:
        cost = float(usage.get("cost") or 0.0)
        self.paid += cost
        _log_spend({"time": time.strftime("%Y-%m-%d %H:%M:%S"), "kind": what, "run": self.run, "key": key, "cost": cost,
                    "prompt_tokens": usage.get("prompt_tokens"), "output_tokens": usage.get("completion_tokens"),
                    "cached_tokens": (usage.get("prompt_tokens_details") or {}).get("cached_tokens"),
                    "total_usd": round(spend_total() + cost, 6)})

    def _call(self, key: str, body: Dict[str, Any], prompt: str, budget: int) -> Dict[str, Any]:
        self._guard(prompt, budget)
        error = ""
        for attempt in (1, 2):
            started = time.perf_counter()
            try:
                r = requests.post(URL, headers={**_auth(), "Content-Type": "application/json"}, data=json.dumps(body), timeout=TIMEOUT_S)
                seconds = time.perf_counter() - started
                data = r.json()
            except (requests.RequestException, ValueError) as exc:
                seconds, data, status = time.perf_counter() - started, {}, None
                error = f"{type(exc).__name__}: {str(exc)[:200]}"
            else:
                status = r.status_code
                if 400 <= status < 500 and status not in (408, 429):  # bad request, no credit, no endpoint: retrying cannot help
                    raise SystemExit(f"OpenRouter refused the request (HTTP {status}): {json.dumps(data.get('error', data))[:400]}")
                usage = data.get("usage") or {}
                choice = (data.get("choices") or [{}])[0]
                text = (choice.get("message") or {}).get("content")
                if usage:
                    self._charge(key, usage, "call" if text else "failed attempt")
                if status == 200 and text and "error" not in data and choice.get("finish_reason") != "error":
                    return {"key": key, "model": self.model_id, "max_tokens": budget,
                            "request": {k: v for k, v in body.items() if k != "messages"},
                            "prompt_head": prompt[:120], "prompt_chars": len(prompt), "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
                            "text": text, "seconds": round(seconds, 3), "prompt_tokens": usage.get("prompt_tokens"),
                            "output_tokens": usage.get("completion_tokens"),
                            "cached_tokens": (usage.get("prompt_tokens_details") or {}).get("cached_tokens"),
                            "reasoning_tokens": (usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
                            "cost": usage.get("cost"), "finish_reason": choice.get("finish_reason"), "provider": data.get("provider"),
                            "served_model": data.get("model"), "generation_id": data.get("id"), "run": self.run, "tag": self.tag,
                            "attempts": attempt, "recorded": time.strftime("%Y-%m-%d %H:%M:%S")}
                error = f"HTTP {status}: {json.dumps(data.get('error') or choice)[:300]}"
            print(f"[openrouter] attempt {attempt} failed: {error}", flush=True)
            if attempt == 1:
                time.sleep(5)
        failure = {"key": key, "run": self.run, "tag": self.tag, "prompt_head": prompt[:120], "error": error,
                   "seconds": round(seconds, 3), "recorded": time.strftime("%Y-%m-%d %H:%M:%S")}
        with FAILURES.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(failure) + "\n")
        return failure
