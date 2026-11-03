"""Guard results on MemoriaBench dev per model variant, from results/guard/<variant>.dev.jsonl and the score cache.

    python3.11 guard_summary.py 4b 0.8b-bf16 0.8b-edit-bf16 0.8b-q4 0.8b-edit-q4

As run: the app's live_check in guard mode, lexical candidates only (no embedding worker), threshold 2.0. From the
cached first-token scores: each probe's strongest candidate log-odds, its AUROC (conflicts against must-not-alert
probes), and catches / false alarms at other thresholds (dev only; a threshold read off this table is chosen on dev).
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def auroc(pos, neg):
    if not pos or not neg:
        return None
    return sum(1.0 if p > n else 0.5 if p == n else 0.0 for p in pos for n in neg) / (len(pos) * len(neg))


def summary(variant):
    rows = [json.loads(l) for l in (HERE / "results" / "guard" / f"{variant}.dev.jsonl").read_text().splitlines() if l.strip()]
    best, seconds = {}, []
    for line in (HERE / "cache" / f"{variant}.jsonl").read_text().splitlines():
        r = json.loads(line)
        if r.get("kind") == "score" and str(r.get("tag", "")).startswith("guard:dev:"):
            probe = r["tag"].split(":", 2)[2]
            value = r["logprobs"]["YES"] - r["logprobs"]["NO"]
            best[probe] = max(best.get(probe, float("-inf")), value)
            seconds.append(r["seconds"])
    pos = [best.get(r["id"], float("-inf")) for r in rows if r["expected_alert"]]
    neg = [best.get(r["id"], float("-inf")) for r in rows if not r["expected_alert"]]
    sweep = {t: [sum(p >= t for p in pos), sum(n >= t for n in neg)] for t in (0.0, 1.0, 2.0, 3.0, 4.0)}
    seconds.sort()
    pct = lambda q: round(seconds[min(len(seconds) - 1, int(q * len(seconds)))], 3) if seconds else None
    return {"variant": variant, "caught_as_run": f"{sum(r['alert'] for r in rows if r['expected_alert'])}/{len(pos)}",
            "false_alarms_as_run": f"{sum(r['alert'] for r in rows if not r['expected_alert'])}/{len(neg)}",
            "auroc_strongest": round(auroc(pos, neg), 3), "caught_false_by_threshold": sweep,
            "questions": len(seconds), "seconds_per_question_p50_p95": [pct(0.5), pct(0.95)],
            "check_ms_p50": sorted(r["latency_ms"] for r in rows)[len(rows) // 2]}


if __name__ == "__main__":
    for v in sys.argv[1:]:
        print(json.dumps(summary(v)))
