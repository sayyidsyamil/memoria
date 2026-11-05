"""JSON-lines service: the desktop app talks to the decision ledger through stdin/stdout.

    python3.11 -m memoria_engine.service --home <folder> [--extractor mlx|keyword|none]

One request per line: {"id": 1, "method": "facts.current", "params": {}}.
One response per line: {"id": 1, "ok": true, "result": ...} or {"id": 1, "ok": false, "error": {"type": "...", "message": "..."}}.
State lives in <home>: ledger.sqlite, ledger.jsonl (append-only log, the database can be rebuilt from it) and registry.json.
Nothing leaves the machine: the language model runs in-process with MLX.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .ledger import AlreadyDone, Evidence, LedgerError, canon, ts
from .evaluation.router import Route
from .fallback_router import AS_RECORDED, fallback_route
from .pipeline import AttributeSpec, Meeting, ObjectSpec, Pipeline, Registry, Turn, make_policy

VERSION = "0.1"
DEFAULT_MODEL = "mlx-community/Qwen3.5-4B-MLX-4bit"
DONE_STATES = ("done", "cancelled")


def now_us() -> int:
    return time.time_ns() // 1000


def iso(us: Optional[int]) -> Optional[str]:
    return None if us is None else datetime.fromtimestamp(us / 1e6, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def registry_from_json(data: Dict[str, Any]) -> Registry:
    objects: Dict[str, ObjectSpec] = {}
    for o in data.get("objects", []):
        attrs = tuple(AttributeSpec(a["name"], a.get("type", "text"), tuple(a.get("values", ())), a.get("change_kind", "REVISE")) for a in o["attributes"])
        if not attrs:
            raise ValueError(f"object {o.get('object_id')!r} has no attributes")
        objects[o["object_id"]] = ObjectSpec(o["object_id"], o.get("kind", "decision"), o.get("label", o["object_id"]), attrs)
    return Registry(objects, dict(data.get("people", {})))


def registry_to_json(reg: Registry) -> Dict[str, Any]:
    return {"objects": [{"object_id": o.object_id, "kind": o.kind, "label": o.label,
                         "attributes": [{"name": a.name, "type": a.type, "values": list(a.values), "change_kind": a.change_kind} for a in o.attributes]}
                        for o in reg.objects.values()], "people": dict(reg.people)}


class Service:
    def __init__(self, home: str, extractor: str = "none", model: Optional[str] = None, policy: str = "confirm_conflicts") -> None:
        self.home = Path(home)
        self.home.mkdir(parents=True, exist_ok=True)
        self.extractor_kind, self.model_id = extractor, model or DEFAULT_MODEL
        self.policy_name = policy
        self._llm: Any = None
        self.registry = registry_from_json(json.loads((self.home / "registry.json").read_text())) if (self.home / "registry.json").exists() else Registry({}, {})
        self.pipe = self._open_pipeline()

    # ---- plumbing --------------------------------------------------------------------------

    def _open_pipeline(self) -> Pipeline:
        pipe = Pipeline(self.registry, None, make_policy(self.policy_name), None,
                        db_path=str(self.home / "ledger.sqlite"), log_path=str(self.home / "ledger.jsonl"))
        pipe.clock.t = now_us()
        self.registry.install(pipe.ledger)
        for s in pipe.ledger.sources():
            pipe.meeting_of_source[s["source_id"]] = s["meeting_id"]
        return pipe

    def _save_registry(self) -> None:
        tmp = self.home / "registry.json.tmp"
        tmp.write_text(json.dumps(registry_to_json(self.registry), indent=1, ensure_ascii=False))
        tmp.replace(self.home / "registry.json")

    def llm(self) -> Any:
        if self._llm is None:
            from .extractors import MLXExtractor

            self._llm = MLXExtractor(self.model_id)
            self._llm.load()
        return self._llm

    def extractor(self, kind: str) -> Any:
        if kind == "mlx":
            from .windowed import WindowedExtractor

            return WindowedExtractor(self.llm())
        if kind == "keyword":
            from .extractors import KeywordExtractor

            return KeywordExtractor()
        return None

    def _touch(self) -> None:
        self.pipe.clock.t = max(self.pipe.clock.t, now_us())

    def _label(self, object_id: str) -> str:
        o = self.registry.objects.get(object_id)
        return o.label if o else object_id

    def _evidence(self, evidence: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        out = []
        for e in evidence:
            out.append({"quote": e["span_text"], "speaker": e["speaker_id"], "meeting": self.pipe.meeting_of_source.get(e["source_id"], e["source_id"][:8]),
                        "char_start": e["char_start"], "char_end": e["char_end"], "audio_start": e["audio_start"], "confidence": e["confidence"], "extractor": e["extractor_model"]})
        return out

    def _fact(self, h: Dict[str, Any], object_id: str, attribute: str) -> Dict[str, Any]:
        return {"fact_id": h["fact_id"], "object_id": object_id, "attribute": attribute, "label": self._label(object_id), "value": h["value"],
                "claim_from": iso(h["claim_from"]), "claim_to": iso(h["claim_to"]), "decided_at": iso(h["decided_at"]), "change_type": h["change_type"],
                "supersedes": h["supersedes_fact_id"], "confirms": h["confirms_fact_id"], "corrects": h["corrects_fact_id"], "retracted": h["retracted"],
                "evidence": self._evidence(h["evidence"])}

    # ---- methods ---------------------------------------------------------------------------

    def ping(self, **_: Any) -> Dict[str, Any]:
        return {"version": VERSION, "home": str(self.home), "extractor": self.extractor_kind, "model": self.model_id, "policy": self.policy_name,
                "objects": len(self.registry.objects), "meetings": len(self.pipe.ledger.sources())}

    def registry_get(self, **_: Any) -> Dict[str, Any]:
        return registry_to_json(self.registry)

    def registry_set(self, objects: List[Dict[str, Any]], people: Optional[Dict[str, str]] = None, **_: Any) -> Dict[str, Any]:
        """Declare the tracked items. Adding items is always allowed; changing an existing item's details is refused by the ledger."""
        new = registry_from_json({"objects": objects, "people": people or {}})
        merged = Registry({**self.registry.objects, **new.objects}, {**self.registry.people, **new.people})
        merged.install(self.pipe.ledger)
        self.registry = self.pipe.registry = merged
        self._save_registry()
        return registry_to_json(merged)

    def meetings_list(self, **_: Any) -> List[Dict[str, Any]]:
        counts: Dict[str, int] = {}
        for obj, attr in self.registry.slots():
            for h in self.pipe.ledger.history(obj, attr):
                for e in h["evidence"]:
                    m = self.pipe.meeting_of_source.get(e["source_id"])
                    counts[m] = counts.get(m, 0) + 1
        return [{"meeting_id": s["meeting_id"], "occurred_at": iso(s["occurred_at"]), "source_id": s["source_id"][:12], "evidence_items": counts.get(s["meeting_id"], 0)}
                for s in self.pipe.ledger.sources()]

    def meetings_ingest(self, meeting_id: str, turns: List[Dict[str, Any]], occurred_at: Optional[str] = None, extractor: Optional[str] = None,
                        policy: Optional[str] = None, **_: Any) -> Dict[str, Any]:
        if not turns:
            raise ValueError("a meeting needs at least one turn")
        if any(m["meeting_id"] == meeting_id for m in self.meetings_list()):
            raise AlreadyDone(f"meeting {meeting_id!r} was already added; each meeting can be added once")
        kind = extractor or self.extractor_kind
        occurred = ts(occurred_at) if occurred_at else now_us()
        built = tuple(Turn(i, str(t["speaker"]), float(t.get("start", 20.0 * i)), " ".join(str(t["text"]).split())) for i, t in enumerate(turns))
        meeting = Meeting(meeting_id, occurred, now_us(), built)
        self.pipe.extractor = self.extractor(kind)
        if policy:
            self.pipe.policy = make_policy(policy)
        if self.pipe.extractor is None:
            self._touch()
            source_id = self.pipe.ledger.add_source(meeting.text, meeting_id, occurred)
            self.pipe.meeting_of_source[source_id] = meeting_id
            return {"meeting_id": meeting_id, "stored_only": True, "turns": len(built), "counts": {}, "items": [], "seconds": 0.0}
        result = self.pipe.ingest(meeting)
        items, counts = [], {}
        for d in result.dispositions:
            counts[d.status] = counts.get(d.status, 0) + 1
            items.append({"status": d.status, "object_id": d.object_id or d.candidate.object_id, "attribute": d.attribute or d.candidate.attribute,
                          "label": self._label(d.object_id or d.candidate.object_id or ""), "value": d.value if d.value is not None else d.candidate.value,
                          "quote": d.candidate.quote, "turn": d.turn, "reason": d.reason, "proposal_id": getattr(d, "proposal_id", None),
                          "outcome": getattr(d, "outcome", None), "changes_belief": getattr(d, "changes_belief", None), "confidence": d.candidate.confidence})
        return {"meeting_id": meeting_id, "stored_only": False, "turns": len(built), "counts": counts, "items": items, "seconds": round(result.seconds, 2), "stats": {k: v for k, v in result.stats.items() if k != "raw"}}

    def facts_current(self, **_: Any) -> List[Dict[str, Any]]:
        out = []
        for obj, attr in self.registry.slots():
            hist = [h for h in self.pipe.ledger.history(obj, attr) if not h["retracted"]]
            belief = self.pipe.ledger.current(obj, attr)
            if belief is None:
                continue
            fact = next((h for h in hist if h["fact_id"] == belief.fact_id), None)
            changes = sum(1 for a, b in zip(self.pipe.ledger.timeline(obj, attr), self.pipe.ledger.timeline(obj, attr)[1:]) if canon(a.value) != canon(b.value))
            row = self._fact(fact, obj, attr) if fact else {"object_id": obj, "attribute": attr, "label": self._label(obj), "value": belief.value, "evidence": []}
            row.update(kind=self.registry.objects[obj].kind, n_changes=changes, valid_from=iso(belief.valid_from))
            out.append(row)
        return out

    def facts_history(self, object_id: str, attribute: str, **_: Any) -> List[Dict[str, Any]]:
        self.registry.spec(object_id, attribute)
        history = self.pipe.ledger.history(object_id, attribute)
        retracted = {h["fact_id"]: h["retracted"] for h in history if h["retracted"]}
        out = []
        for h in history:
            fact = self._fact(h, object_id, attribute)
            replaced = retracted.get(h["corrects_fact_id"]) if h["corrects_fact_id"] else None
            if replaced:
                fact["correction"] = {"reviewer": replaced["by"], "reason": replaced["reason"].removeprefix("corrected: "), "replaced_fact_id": h["corrects_fact_id"]}
            out.append(fact)
        return out

    def query(self, type: str, object_id: str, attribute: str, valid_at: Optional[str] = None, tx_at: Optional[str] = None, **_: Any) -> Dict[str, Any]:
        self.registry.spec(object_id, attribute)
        ledger = self.pipe.ledger
        if type == "n_changes":
            pieces = ledger.timeline(object_id, attribute)
            return {"type": type, "answer": sum(1 for a, b in zip(pieces, pieces[1:]) if canon(a.value) != canon(b.value)), "evidence": []}
        valid = now_us() if type == "current" else ts(f"{valid_at}T00:00:00Z" if len(valid_at or "") == 10 else valid_at)
        belief = ledger.as_of(object_id, attribute, valid_at=valid, tx_at=ts(tx_at) if (type == "as_of_tx" and tx_at) else None)
        if belief is None:
            return {"type": type, "answer": None, "evidence": []}
        hist = {h["fact_id"]: h for h in ledger.history(object_id, attribute)}
        return {"type": type, "answer": belief.value, "decided_at": iso(belief.decided_at), "evidence": self._evidence(hist[belief.fact_id]["evidence"]) if belief.fact_id in hist else []}

    def ask(self, question: str, **_: Any) -> Dict[str, Any]:
        from .evaluation import router as routing

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        started = time.perf_counter()
        route = routing.MLXRouter(self.llm()).route(self.registry, today, question)
        source = "model"
        if route.ok and route.type == "as_of_tx" and not AS_RECORDED.search(question):
            # the model often sends "what was decided as of 5 February" as "what the records said on 5 February"; without a cue such as
            # "recorded" or "known" the question is about the value that held on that date
            route = Route("as_of_valid", route.object_id, route.attribute, route.valid_at, None, ok=True, reason="no 'recorded by' cue in the question")
            source = "model, corrected by a rule"
        if not route.ok:
            second = fallback_route(self.registry, today, question)
            if second.ok:
                route, source = second, "rules"
        if not route.ok:
            return {"ok": False, "reason": "the question is not about a tracked item or could not be understood", "route": route.as_dict()}
        answer = self.query(route.type, route.object_id, route.attribute, route.valid_at, route.tx_at)
        return {"ok": True, "route": route.as_dict(), "route_source": source, "label": self._label(route.object_id), "seconds": round(time.perf_counter() - started, 2), **answer}

    def proposals_list(self, **_: Any) -> List[Dict[str, Any]]:
        out = []
        for p in self.pipe.ledger.pending_proposals():
            a = p["payload"]
            ev = a["evidence"][0] if a.get("evidence") else {}
            belief = self.pipe.ledger.current(a["object_id"], a["attribute"])
            out.append({"proposal_id": p["proposal_id"], "object_id": a["object_id"], "label": self._label(a["object_id"]), "attribute": a["attribute"], "value": a["value"],
                        "current_value": None if belief is None else belief.value, "confidence": p["confidence"], "reason": p["reason"],
                        "quote": ev.get("span_text"), "speaker": ev.get("speaker_id"), "meeting": self.pipe.meeting_of_source.get(ev.get("source_id", ""), None)})
        return out

    def proposals_accept(self, proposal_id: int, edits: Optional[Dict[str, Any]] = None, reviewer: str = "user", note: Optional[str] = None, **_: Any) -> Dict[str, Any]:
        self._touch()
        if edits and "value" in edits:
            proposal = next((p for p in self.pipe.ledger.pending_proposals() if p["proposal_id"] == proposal_id), None)
            if proposal is not None:
                slot = proposal["payload"]
                edits = {**edits, "value": self.registry.normalise(slot["object_id"], slot["attribute"], edits["value"])}
        out = self.pipe.ledger.accept(proposal_id, reviewer, edits=edits, note=note)
        return {"fact_id": out.fact_id, "status": out.status}

    def proposals_reject(self, proposal_id: int, reviewer: str = "user", note: Optional[str] = None, **_: Any) -> Dict[str, Any]:
        self._touch()
        self.pipe.ledger.reject(proposal_id, reviewer, note)
        return {"rejected": proposal_id}

    def facts_correct(self, fact_id: int, value: Any, reason: str, reviewer: str = "user", **_: Any) -> Dict[str, Any]:
        self._touch()
        row = self.pipe.ledger._fact_row(fact_id)
        value = self.registry.normalise(row["object_id"], row["attribute"], value)
        out = self.pipe.ledger.correct(fact_id, reviewer, reason, value=value)
        return {"fact_id": out.fact_id, "status": out.status}

    def facts_retract(self, fact_id: int, reason: str, reviewer: str = "user", **_: Any) -> Dict[str, Any]:
        self._touch()
        self.pipe.ledger.retract(fact_id, reviewer, reason)
        return {"retracted": fact_id}

    def brief(self, **_: Any) -> Dict[str, Any]:
        """What a chair needs before the next meeting: open commitments, recent changes, items waiting for review."""
        current = self.facts_current()
        status = {f["object_id"]: f["value"] for f in current if f["attribute"] == "status"}
        open_items = []
        for obj in {f["object_id"] for f in current if f["kind"] == "commitment"}:
            if status.get(obj) in DONE_STATES:
                continue
            parts = {f["attribute"]: f["value"] for f in current if f["object_id"] == obj}
            open_items.append({"object_id": obj, "label": self._label(obj), **{k: v for k, v in parts.items() if k != "status"}, "status": status.get(obj, "open")})
        changes = []
        for obj, attr in self.registry.slots():
            hist = [h for h in self.pipe.ledger.history(obj, attr) if not h["retracted"]]
            for prev, cur in zip(hist, hist[1:]):
                if canon(prev["value"]) != canon(cur["value"]):
                    changes.append({"label": self._label(obj), "attribute": attr, "from": prev["value"], "to": cur["value"], "decided_at": iso(cur["decided_at"]),
                                    "quote": cur["evidence"][0]["span_text"] if cur["evidence"] else None})
        changes.sort(key=lambda c: c["decided_at"] or "", reverse=True)
        return {"open_commitments": open_items, "recent_changes": changes[:20], "decisions": [f for f in current if f["kind"] == "decision"], "waiting_for_review": len(self.pipe.ledger.pending_proposals()),
                "meetings": len(self.pipe.ledger.sources())}

    def check(self, **_: Any) -> Dict[str, Any]:
        problems = self.pipe.ledger.check_invariants()
        return {"ok": not problems, "problems": problems}


METHODS = {"ping": "ping", "registry.get": "registry_get", "registry.set": "registry_set", "meetings.list": "meetings_list", "meetings.ingest": "meetings_ingest",
           "facts.current": "facts_current", "facts.history": "facts_history", "query": "query", "ask": "ask", "proposals.list": "proposals_list",
           "proposals.accept": "proposals_accept", "proposals.reject": "proposals_reject", "facts.correct": "facts_correct", "facts.retract": "facts_retract",
           "brief": "brief", "check": "check"}


def handle(service: Service, line: str) -> Dict[str, Any]:
    req_id = None
    try:
        req = json.loads(line)
        req_id = req.get("id")
        name = METHODS.get(req.get("method", ""))
        if name is None:
            raise ValueError(f"unknown method {req.get('method')!r}; known: {sorted(METHODS)}")
        return {"id": req_id, "ok": True, "result": getattr(service, name)(**(req.get("params") or {}))}
    except (LedgerError, ValueError, KeyError, TypeError) as exc:
        return {"id": req_id, "ok": False, "error": {"type": type(exc).__name__, "message": str(exc)}}
    except Exception as exc:  # the service must stay alive whatever one request does
        return {"id": req_id, "ok": False, "error": {"type": type(exc).__name__, "message": str(exc), "trace": traceback.format_exc(limit=3)}}


def main(argv: Optional[List[str]] = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--home", required=True)
    ap.add_argument("--extractor", choices=("mlx", "keyword", "none"), default="mlx")
    ap.add_argument("--model", default=None)
    ap.add_argument("--policy", default="confirm_conflicts")
    args = ap.parse_args(argv)
    service = Service(args.home, args.extractor, args.model, args.policy)
    print(json.dumps({"id": None, "ok": True, "result": {"ready": True, **service.ping()}}), flush=True)
    for line in sys.stdin:
        if line.strip():
            print(json.dumps(handle(service, line), default=str, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
