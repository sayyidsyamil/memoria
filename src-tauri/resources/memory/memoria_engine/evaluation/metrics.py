"""Scoring: extraction quality, ledger-level supersession, question answering, calibration, intervals."""
from __future__ import annotations

import math
import random
from collections import Counter
from typing import Any, Dict, List, Optional, Sequence, Tuple

from ..ledger import canon
from ..pipeline import Disposition, MeetingResult, Pipeline, Registry
from .dataset import Chain, GoldEvent, GoldMeeting
from .oracle import values_equal

STATE_KINDS = ("INITIAL", "REVISE", "REVERSE", "CANCEL", "COMPLETE")


# ---- statistics ------------------------------------------------------------------------------

def wilson(k: int, n: int, z: float = 1.96) -> Tuple[Optional[float], Optional[float]]:
    if n == 0:
        return None, None
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def prf(tp: int, fp: int, fn: int) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    p = tp / (tp + fp) if tp + fp else None
    r = tp / (tp + fn) if tp + fn else None
    f = 2 * p * r / (p + r) if p is not None and r is not None and p + r else (0.0 if p is not None and r is not None else None)
    return p, r, f


def bootstrap_prf(per_meeting: Sequence[Tuple[int, int, int]], n_boot: int = 2000, seed: int = 0) -> Dict[str, Any]:
    rnd, samples = random.Random(seed), {"precision": [], "recall": [], "f1": []}
    for _ in range(n_boot):
        pick = [per_meeting[rnd.randrange(len(per_meeting))] for _ in per_meeting]
        p, r, f = prf(sum(t[0] for t in pick), sum(t[1] for t in pick), sum(t[2] for t in pick))
        for name, value in (("precision", p), ("recall", r), ("f1", f)):
            if value is not None:
                samples[name].append(value)
    out = {}
    for name, values in samples.items():
        values.sort()
        out[name] = (round(values[int(0.025 * len(values))], 3), round(values[int(0.975 * len(values)) - 1], 3)) if values else None
    return out


def auroc(positives: Sequence[float], negatives: Sequence[float]) -> Optional[float]:
    if not positives or not negatives:
        return None
    wins = sum(1.0 if p > n else 0.5 if p == n else 0.0 for p in positives for n in negatives)
    return wins / (len(positives) * len(negatives))


def ece(confidences: Sequence[float], labels: Sequence[int], bins: int = 10) -> Optional[float]:
    if not confidences:
        return None
    total, error = len(confidences), 0.0
    for b in range(bins):
        members = [(c, y) for c, y in zip(confidences, labels) if (c >= b / bins) and (c < (b + 1) / bins or (b == bins - 1 and c <= 1.0))]
        if members:
            error += len(members) / total * abs(sum(c for c, _ in members) / len(members) - sum(y for _, y in members) / len(members))
    return error


# ---- extraction ------------------------------------------------------------------------------

def _near(turn: int, g: GoldEvent) -> bool:
    """A prediction counts as the gold event when its turn is within 2 turns, or inside the gold window tag win_<lo>_<hi>
    (real meetings spread one decision over many turns; the window comes from the human summary-to-utterance links)."""
    for tag in g.tags:
        if tag.startswith("win_"):
            try:
                lo, hi = (int(x) for x in tag[4:].split("_"))
            except ValueError:
                continue
            if lo <= turn <= hi:
                return True
    return abs(turn - g.turn) <= 2


def _same_content(d: Disposition, g: GoldEvent) -> bool:
    return (d.object_id == g.object_id and d.attribute == g.attribute and values_equal(d.value, g.value)
            and (g.valid_from is None or d.valid_from == g.valid_from))


def _raw_matches(d: Disposition, g: GoldEvent, registry: Registry) -> bool:
    c = d.candidate
    try:
        return (c.object_id == g.object_id and c.attribute == g.attribute
                and values_equal(registry.normalise(c.object_id, c.attribute, c.value), g.value))
    except (KeyError, ValueError, TypeError):
        return False


def _miss_reason(g: GoldEvent, reach: List[Disposition], filtered: List[Disposition], registry: Registry) -> str:
    if any(d.status == "ungrounded" and _raw_matches(d, g, registry) for d in filtered):
        return "ungrounded"
    at_turn = [d for d in reach if d.turn == g.turn]
    for d in at_turn:
        if d.object_id == g.object_id and d.attribute == g.attribute:
            return "temporal_error" if values_equal(d.value, g.value) else "value_error"
    if any(d.object_id == g.object_id for d in at_turn):
        return "attribute_error"
    if at_turn:
        return "link_error"
    if any(d.status == "unresolved" and d.turn is not None and abs(d.turn - g.turn) <= 1 for d in filtered):
        return "unresolved"
    if any(_same_content(d, g) for d in reach):
        return "wrong_evidence"
    return "missed"


def score_meeting(gm: GoldMeeting, result: MeetingResult, registry: Registry) -> Dict[str, Any]:
    reach = [d for d in result.dispositions if d.status in ("applied", "proposed")]
    filtered = [d for d in result.dispositions if d.status in ("ungrounded", "invalid", "unresolved")]
    used, tp, miss = set(), [], []
    for g in gm.events:
        options = [(abs(d.turn - g.turn), i) for i, d in enumerate(reach) if i not in used and _same_content(d, g) and _near(d.turn, g)]
        if options:
            gap, i = min(options)
            used.add(i)
            tp.append({"event": g.event_id, "kind": g.kind, "tags": list(g.tags), "exact_turn": gap == 0, "confidence": reach[i].candidate.confidence})
        else:
            miss.append({"event": g.event_id, "kind": g.kind, "tags": list(g.tags), "reason": _miss_reason(g, reach, filtered, registry)})
    fp = []
    for i, d in enumerate(reach):
        if i in used:
            continue
        kind = gm.distractors.get(d.turn)
        if kind == "ignorable":
            continue
        reason = f"distractor:{kind}" if kind else ("wrong_content" if any(g.turn == d.turn for g in gm.events) else "spurious")
        fp.append({"reason": reason, "confidence": d.candidate.confidence, "status": d.status})
    hit_turns = {d.turn for d in reach if gm.distractors.get(d.turn) not in (None, "ignorable")}
    return {
        "meeting_id": gm.meeting.meeting_id, "n_gold": len(gm.events), "tp": tp, "miss": miss, "fp": fp,
        "reach": len(reach), "filtered": dict(Counter(d.status for d in filtered)),
        "distractor_turns": sum(1 for k in gm.distractors.values() if k != "ignorable"), "distractor_turns_hit": len(hit_turns),
        "candidates": len(result.dispositions),
    }


def aggregate_extraction(scores: Sequence[Dict[str, Any]], seed: int = 0) -> Dict[str, Any]:
    tp = sum(len(s["tp"]) for s in scores)
    fp = sum(len(s["fp"]) for s in scores)
    fn = sum(len(s["miss"]) for s in scores)
    p, r, f = prf(tp, fp, fn)
    by_kind: Dict[str, Dict[str, Any]] = {}
    by_tag: Dict[str, Dict[str, Any]] = {}
    for s in scores:
        for item in s["tp"] + s["miss"]:
            hit = "reason" not in item
            for table, keys in ((by_kind, [item["kind"]]), (by_tag, item["tags"] or ["(no tag)"])):
                for key in keys:
                    cell = table.setdefault(key, {"gold": 0, "found": 0})
                    cell["gold"] += 1
                    cell["found"] += hit
    for table in (by_kind, by_tag):
        for cell in table.values():
            cell["recall"] = round(cell["found"] / cell["gold"], 3)
    state_tp = sum(1 for s in scores for t in s["tp"] if t["kind"] in STATE_KINDS)
    state_gold = sum(1 for s in scores for t in s["tp"] + s["miss"] if t["kind"] in STATE_KINDS)
    d_turns = sum(s["distractor_turns"] for s in scores)
    d_hit = sum(s["distractor_turns_hit"] for s in scores)
    positives = [t["confidence"] for s in scores for t in s["tp"] if t["confidence"] is not None]
    negatives = [f_["confidence"] for s in scores for f_ in s["fp"] if f_["confidence"] is not None]
    confidences = positives + negatives
    return {
        "gold_events": tp + fn, "tp": tp, "fp": fp, "fn": fn,
        "precision": p, "recall": r, "f1": f,
        "ci_95": bootstrap_prf([(len(s["tp"]), len(s["fp"]), len(s["miss"])) for s in scores], seed=seed),
        "state_changing_recall": state_tp / state_gold if state_gold else None, "state_changing_gold": state_gold,
        "by_kind": by_kind, "by_tag": by_tag,
        "miss_reasons": dict(Counter(m["reason"] for s in scores for m in s["miss"])),
        "fp_reasons": dict(Counter(f_["reason"] for s in scores for f_ in s["fp"])),
        "filtered": dict(sum((Counter(s["filtered"]) for s in scores), Counter())),
        "distractor_hit_rate": d_hit / d_turns if d_turns else None, "distractor_turns": d_turns,
        "evidence_exact_turn": sum(1 for s in scores for t in s["tp"] if t["exact_turn"]) / tp if tp else None,
        "confidence_auroc": auroc(positives, negatives),
        "confidence_ece": ece(confidences, [1] * len(positives) + [0] * len(negatives)),
        "confidence_mean": (sum(confidences) / len(confidences)) if confidences else None,
        "confidence_distinct": len({round(c, 2) for c in confidences}),
    }


# ---- review burden ---------------------------------------------------------------------------

def review_burden(results: Sequence[MeetingResult]) -> Dict[str, Any]:
    ds = [d for r in results for d in r.dispositions]
    proposed = [d for d in ds if d.status == "proposed"]
    reviewed = Counter(d.review for d in proposed)
    n = len(results)
    return {
        "meetings": n, "applied_directly": sum(1 for d in ds if d.status == "applied"), "proposed": len(proposed),
        "proposals_per_meeting": len(proposed) / n if n else None,
        "accepted": reviewed.get("accepted", 0), "accepted_edited": reviewed.get("accepted_edited", 0),
        "rejected": reviewed.get("rejected", 0), "pending": reviewed.get("pending", 0),
        "acceptance_rate": reviewed.get("accepted", 0) / len(proposed) if proposed else None,
    }


# ---- ledger level ----------------------------------------------------------------------------

def _facts(p: Pipeline, chain: Chain) -> Tuple[Dict[int, Tuple], set]:
    keys, links = {}, set()
    for obj, attr in chain.registry.slots():
        history = [h for h in p.ledger.history(obj, attr) if not h["retracted"]]
        for h in history:
            keys[h["fact_id"]] = (p.meeting_of_source[h["evidence"][0]["source_id"]], obj, attr, canon(h["value"]))
        for h in history:
            if h["supersedes_fact_id"] in keys:
                links.add((keys[h["fact_id"]], keys[h["supersedes_fact_id"]]))
    return keys, links


def ledger_scores(pred: Pipeline, gold: Pipeline, chain: Chain) -> Dict[str, Any]:
    _, pred_links = _facts(pred, chain)
    _, gold_links = _facts(gold, chain)
    tp = len(pred_links & gold_links)
    p, r, f = prf(tp, len(pred_links - gold_links), len(gold_links - pred_links))
    state_gold = state_correct = phantom = 0
    for obj, attr in chain.registry.slots():
        g = gold.ledger.as_of(obj, attr, valid_at=chain.now)
        q = pred.ledger.as_of(obj, attr, valid_at=chain.now)
        if g is not None:
            state_gold += 1
            state_correct += q is not None and values_equal(q.value, g.value)
        elif q is not None:
            phantom += 1
    return {"supersession_tp": tp, "supersession_fp": len(pred_links - gold_links), "supersession_fn": len(gold_links - pred_links),
            "supersession_precision": p, "supersession_recall": r, "supersession_f1": f,
            "state_gold": state_gold, "state_correct": state_correct, "phantom_beliefs": phantom}


def sum_ledger_scores(items: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    keys = ("supersession_tp", "supersession_fp", "supersession_fn", "state_gold", "state_correct", "phantom_beliefs")
    total = {k: sum(i[k] for i in items) for k in keys}
    p, r, f = prf(total["supersession_tp"], total["supersession_fp"], total["supersession_fn"])
    total.update(supersession_precision=p, supersession_recall=r, supersession_f1=f,
                 state_accuracy=total["state_correct"] / total["state_gold"] if total["state_gold"] else None)
    return total


# ---- question answering ----------------------------------------------------------------------

def score_answers(items: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    def cell(rows: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
        k, n = sum(1 for r in rows if r["correct"]), len(rows)
        low, high = wilson(k, n)
        return {"correct": k, "n": n, "accuracy": k / n if n else None, "ci_95": (round(low, 3), round(high, 3)) if low is not None else None}
    out = {"overall": cell(items)}
    for kind in sorted({i["type"] for i in items}):
        out[kind] = cell([i for i in items if i["type"] == kind])
    return out


def paired_sign_test(a: Sequence[bool], b: Sequence[bool]) -> Dict[str, Any]:
    """Exact two-sided sign test on questions answered correctly by only one of two systems (same questions, same order)."""
    if len(a) != len(b):
        raise ValueError("paired samples must have the same length")
    a_only = sum(1 for x, y in zip(a, b) if x and not y)
    b_only = sum(1 for x, y in zip(a, b) if y and not x)
    n = a_only + b_only
    tail = sum(math.comb(n, i) for i in range(min(a_only, b_only) + 1)) / 2 ** n if n else 1.0
    return {"a_only": a_only, "b_only": b_only, "both": sum(1 for x, y in zip(a, b) if x and y),
            "neither": sum(1 for x, y in zip(a, b) if not x and not y), "p_two_sided": min(1.0, 2 * tail)}
