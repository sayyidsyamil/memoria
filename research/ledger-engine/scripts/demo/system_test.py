"""End-to-end system test through the app's own interface (the JSON-lines service), on the fictional demo series.

    cd engine && python3.11 scripts/demo/system_test.py [--extractor mlx|keyword] [--out results/demo/system_test]

Steps (what a user does in the app): set up tracked items -> add the 3 meeting notes -> review the inbox (accept all) ->
read the current facts -> ask the 21 questions in plain English -> prepare the brief -> health check.
Compares with the answer key derived from the gold events. Writes <out>.json and <out>.md.
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parents[1]
sys.path.insert(0, str(ENGINE))

from memoria_engine.evaluation.dataset import load_chains  # noqa: E402
from memoria_engine.evaluation.oracle import values_equal  # noqa: E402
from memoria_engine.evaluation.run_eval import run_pipeline  # noqa: E402
from memoria_engine.extractors import OracleExtractor  # noqa: E402
from memoria_engine.pipeline import numbers_in  # noqa: E402

DEMO = ENGINE / "data" / "demo"
PYTHON = sys.executable
HEADER = re.compile(r"^\*\*(?P<name>.+?)\*\*\s*·\s*(?P<clock>\d+:\d{2}(?::\d{2})?)\s*$")


def parse_note(path: Path):
    """Python port of the app's transcript-note reader (src/lib/transcriptNote.ts)."""
    text = path.read_text()
    date = re.search(r"^date:\s*(\d{4}-\d{2}-\d{2})", text, re.M).group(1)
    body = text.split("## Transcript", 1)[1]
    turns, current = [], None
    for line in body.splitlines():
        m = HEADER.match(line.strip())
        if m:
            parts = [int(p) for p in m["clock"].split(":")]
            start = parts[0] * 3600 + parts[1] * 60 + parts[2] if len(parts) == 3 else parts[0] * 60 + parts[1]
            current = {"speaker": m["name"], "text": "", "start": float(start)}
            turns.append(current)
        elif line.strip() and current is not None:
            current["text"] = (current["text"] + " " + line.strip()).strip()
    return date, turns


def asr_turns(i: int):
    """Turns of the app's final transcript of demo audio i, with each speaker label named after the reference speaker it overlaps most."""
    final = json.loads((ENGINE / "results" / "asr" / "app_path_raw" / f"demo_{i}.json").read_text())["final_event"]
    ref = []
    for line in (DEMO / "audio" / f"meeting_{i}.rttm").read_text().splitlines():
        f = line.split()
        ref.append((float(f[3]), float(f[3]) + float(f[4]), f[7].replace("_", " ")))
    names = {}
    for t in final["turns"]:
        overlap = {}
        for a, b, who in ref:
            o = min(t["t1"], b) - max(t["t0"], a)
            if o > 0:
                overlap[who] = overlap.get(who, 0.0) + o
        names.setdefault(t["speaker"], {})
        for who, o in overlap.items():
            names[t["speaker"]][who] = names[t["speaker"]].get(who, 0.0) + o
    naming = {label: max(c, key=c.get) for label, c in names.items() if c}
    return [{"speaker": naming.get(t["speaker"], t["speaker"]), "text": t["text"], "start": float(t["t0"])} for t in final["turns"]]


class Client:
    def __init__(self, home: str, extractor: str):
        self.proc = subprocess.Popen([PYTHON, "-m", "memoria_engine.service", "--home", home, "--extractor", extractor], cwd=ENGINE,
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        ready = json.loads(self.proc.stdout.readline())
        assert ready["ok"] and ready["result"]["ready"], ready
        self.n = 0

    def call(self, method: str, **params):
        self.n += 1
        self.proc.stdin.write(json.dumps({"id": self.n, "method": method, "params": params}) + "\n")
        self.proc.stdin.flush()
        reply = json.loads(self.proc.stdout.readline())
        assert reply["id"] == self.n, reply
        if not reply["ok"]:
            raise RuntimeError(f"{method}: {reply['error']}")
        return reply["result"]

    def close(self):
        self.proc.stdin.close()
        self.proc.wait(timeout=30)


def shown(value):
    return "none" if value is None else str(value)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--extractor", default="mlx", choices=("mlx", "keyword"))
    ap.add_argument("--out", default="results/demo/system_test")
    ap.add_argument("--reviewer", default="accept_all", choices=("accept_all", "careful"),
                    help="accept_all: a user who accepts every suggestion; careful: accepts a suggestion only if the answer key has that decision, rejects the rest")
    ap.add_argument("--snapshot", default="", help="write the final state (facts, history, inbox, meetings, brief) as JSON for the screenshots")
    ap.add_argument("--transcripts", default="notes", choices=("notes", "asr"),
                    help="notes: the scripted notes; asr: the app's own transcripts of the text-to-speech audio (speakers named by overlap with the reference, as a user who names them correctly)")
    args = ap.parse_args()
    chain = load_chains(str(DEMO))[0]
    gold_pipe = run_pipeline(chain, OracleExtractor(chain), "immediate")["pipeline"]
    gold_state = {}
    for obj, attr in chain.registry.slots():
        belief = gold_pipe.ledger.current(obj, attr)
        gold_state[f"{obj}.{attr}"] = None if belief is None else belief.value

    report = {"extractor": args.extractor, "transcripts": args.transcripts, "steps": {}}
    t0 = time.perf_counter()
    with tempfile.TemporaryDirectory() as home:
        c = Client(home, args.extractor)
        try:
            registry = json.loads((DEMO / "registry.json").read_text())
            c.call("registry.set", **registry)
            report["steps"]["registry"] = {"objects": len(registry["objects"])}

            ingests = []
            for i in (1, 2, 3):
                date, turns = parse_note(DEMO / f"meeting_{i}.md")
                if args.transcripts == "asr":
                    turns = asr_turns(i)
                res = c.call("meetings.ingest", meeting_id=f"m{i}", turns=turns, occurred_at=f"{date}T09:30:00Z")
                ingests.append({"meeting": f"m{i}", "turns": len(turns), "seconds": res["seconds"], "counts": res["counts"]})
            report["steps"]["ingest"] = ingests

            pending = c.call("proposals.list")
            report["steps"]["review"] = {"pending": len(pending), "items": [{"label": p["label"], "attribute": p["attribute"], "value": p["value"], "current": p["current_value"], "quote": p["quote"]} for p in pending]}
            gold_values = {(e.object_id, e.attribute): [] for gm in chain.meetings for e in gm.events}
            for gm in chain.meetings:
                for e in gm.events:
                    gold_values[(e.object_id, e.attribute)].append(e.value)
            accepted = stale = rejected = edited = 0
            for p in pending:
                edits = None
                if args.reviewer == "careful" and p.get("reason") == "the number is not in the quote":
                    # a person reads the quote and fixes the number
                    nums = sorted({n for n in numbers_in(p["quote"] or "") if n >= 1000})
                    if len(nums) == 1:
                        edits = {"value": int(nums[0]) if float(nums[0]).is_integer() else nums[0]}
                proposed_value = edits["value"] if edits else p["value"]
                wanted = args.reviewer == "accept_all" or any(values_equal(proposed_value, v) for v in gold_values.get((p["object_id"], p["attribute"]), []))
                if not wanted:
                    c.call("proposals.reject", proposal_id=p["proposal_id"], note="not a decision in the answer key")
                    rejected += 1
                    continue
                try:
                    c.call("proposals.accept", proposal_id=p["proposal_id"], **({"edits": edits} if edits else {}))
                    accepted += 1
                    edited += 1 if edits else 0
                except RuntimeError as exc:
                    if "StaleProposal" not in str(exc):
                        raise
                    c.call("proposals.reject", proposal_id=p["proposal_id"], note="stale: the belief changed after this was suggested")
                    stale += 1
            report["steps"]["review"].update(reviewer=args.reviewer, accepted=accepted, edited=edited, rejected=rejected, rejected_as_stale=stale)

            facts = c.call("facts.current")
            got = {f"{f['object_id']}.{f['attribute']}": f["value"] for f in facts}
            rows = []
            for slot, want in gold_state.items():
                rows.append({"slot": slot, "gold": want, "got": got.get(slot), "ok": values_equal(got.get(slot), want), "evidence": bool(next((f["evidence"] for f in facts if f"{f['object_id']}.{f['attribute']}" == slot), []))})
            phantom = [s for s in got if gold_state.get(s) is None]
            report["steps"]["facts"] = {"slots": len(rows), "correct": sum(r["ok"] for r in rows), "phantom": phantom, "rows": rows}

            answers = []
            for q in chain.questions:
                t = time.perf_counter()
                r = c.call("ask", question=q.ask)
                # through the service the "recorded at" time is the real ingestion time, so a question about what had been recorded
                # by a date before the test ran has the correct answer "nothing recorded yet"
                gold = None if q.type == "as_of_tx" else q.gold
                answers.append({"qid": q.qid, "type": q.type, "question": q.ask, "gold": gold, "answer": r.get("answer") if r.get("ok") else None, "routed": r.get("ok"),
                                "correct": bool(r.get("ok")) and values_equal(r.get("answer"), gold), "has_evidence": bool(r.get("evidence")), "seconds": round(time.perf_counter() - t, 2),
                                "route": (r.get("route") or {}).get("type"), "route_source": r.get("route_source")})
            by_type = {}
            for a in answers:
                by_type.setdefault(a["type"], []).append(a["correct"])
            report["steps"]["ask"] = {"n": len(answers), "correct": sum(a["correct"] for a in answers), "by_type": {k: f"{sum(v)}/{len(v)}" for k, v in by_type.items()}, "rows": answers}

            if args.snapshot:
                snap = {"registry": registry, "meetings": c.call("meetings.list"), "facts": facts, "inbox": c.call("proposals.list"), "inbox_before_review": pending,
                        "history": {f"{f['object_id']}.{f['attribute']}": c.call("facts.history", object_id=f["object_id"], attribute=f["attribute"]) for f in facts},
                        "brief": c.call("brief")}
                Path(ENGINE / args.snapshot).parent.mkdir(parents=True, exist_ok=True)
                (ENGINE / args.snapshot).write_text(json.dumps(snap, indent=1, default=str))
            brief = c.call("brief")
            report["steps"]["brief"] = {"open_commitments": [o["label"] for o in brief["open_commitments"]], "recent_changes": len(brief["recent_changes"]), "meetings": brief["meetings"]}
            report["steps"]["check"] = c.call("check")
        finally:
            c.close()
    report["wall_seconds"] = round(time.perf_counter() - t0, 1)

    out = ENGINE / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.with_suffix(".json").write_text(json.dumps(report, indent=1, default=str))
    f, a = report["steps"]["facts"], report["steps"]["ask"]
    md = [f"# System test on the fictional demo series (extractor: {args.extractor}; transcripts: {args.transcripts})", "",
          f"Through the app's JSON service. Wall time {report['wall_seconds']} s. Reviewer: {report['steps']['review']['reviewer']}. Inbox held {report['steps']['review']['pending']} proposal(s): {report['steps']['review']['accepted']} accepted ({report['steps']['review']['edited']} after fixing the number from the quote), {report['steps']['review']['rejected']} rejected as not in the answer key, {report['steps']['review']['rejected_as_stale']} rejected as stale.", "",
          f"- Facts after review: {f['correct']}/{f['slots']} slots match the answer key; phantom facts (value where none expected): {len(f['phantom'])}.",
          f"- Questions: {a['correct']}/{a['n']} correct ({', '.join(f'{k} {v}' for k, v in a['by_type'].items())}).",
          f"- Health check: {report['steps']['check']}", "", "| Q | Type | Question | Gold | Answer | OK | Evidence shown |", "|---|---|---|---|---|---|---|"]
    md += [f"| {r['qid']} | {r['type']} | {r['question']} | {shown(r['gold'])} | {shown(r['answer'])} | {'yes' if r['correct'] else 'NO'} | {'yes' if r['has_evidence'] else 'no'} |" for r in a["rows"]]
    out.with_suffix(".md").write_text("\n".join(md) + "\n")
    print("\n".join(md[:6]))


if __name__ == "__main__":
    main()
