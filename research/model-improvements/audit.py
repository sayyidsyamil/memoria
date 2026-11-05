"""Every write and every miss of a run on development series, classified, with its quote (no model; dev splits only).

    python3.11 audit.py <variant> <mechanism> <split[,split]> [--md results/audit/x.md]

Writes are classified against the gold value in force once their meeting's decisions are taken (score_meeting's
true positive; agrees = a restatement; earlier_value; other_value; no_gold_value_yet). Each write also gets cheap
lexical flags read from its turn, for describing errors only (they choose nothing): question mark, hedge words,
conditional, whether the turn names the item, the value, or another tracked item.
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.dont_write_bytecode = True
import harness  # noqa: E402
from lm import LM  # noqa: E402
from memoria_engine.evaluation.metrics import _near, _same_content  # noqa: E402
from memoria_engine.evaluation.oracle import values_equal  # noqa: E402

HERE = Path(__file__).resolve().parent
HEDGE = re.compile(r"\b(maybe|perhaps|might|could|i think|i guess|probably|how about|what about|should we|i'd say|possibly|kind of|sort of)\b", re.I)
IF = re.compile(r"\b(if|unless|otherwise|depends)\b", re.I)
STOP = set("the a an of to and is are for with what which whether remote remote's it its in on".split())


def words(text):
    return {w for w in re.findall(r"[a-z]+", text.casefold()) if w not in STOP and len(w) > 2}


def flags(chain, slot, value, text):
    spec = chain.registry.objects[slot]
    own = words(spec.label + " " + slot.replace("_", " "))
    others = set().union(*(words(o.label + " " + o.object_id.replace("_", " ")) for o in chain.registry.objects.values() if o.object_id != slot)) - own
    t = words(text)
    return {"question": "?" in text, "hedge": bool(HEDGE.search(text)), "conditional": bool(IF.search(text)),
            "names_item": bool(own & t), "names_value": bool(words(str(value)) & t), "names_other_item": bool(others & t)}


def audit(variant, mechanism, splits):
    if any(s not in ("old-dev", "new-dev") for s in splits.split(",")):
        raise SystemExit("audit is for development splits only")
    lm = LM(variant, HERE / "cache" / f"{variant}.jsonl", offline=True)
    if variant == "october":  # October's own replies (900 tokens, no system message), for comparison
        from check_harness import OCTOBER, OctoberReplies
        lm = OctoberReplies(OCTOBER / "cache" / "ami_dev_memoria.jsonl")
    rows, misses = [], []
    for chain in harness.load_series(harness.series_of(splits)):
        run = harness.run_chain(chain, lm, mechanism)
        gold = harness.gold_pipeline(chain)
        for gm, res in zip(chain.meetings, run["results"]):
            reach = [d for d in res.dispositions if d.status in ("applied", "proposed")]
            used, matched = set(), {}
            for g in gm.events:
                options = [(abs(d.turn - g.turn), i) for i, d in enumerate(reach) if i not in used and _same_content(d, g) and _near(d.turn, g)]
                if options:
                    used.add(min(options)[1])
                    matched[min(options)[1]] = g
                else:
                    misses.append({"meeting": gm.meeting.meeting_id, "slot": g.object_id, "value": g.value, "kind": g.kind, "turn": g.turn,
                                   "gold_quote": g.quote[:160]})
            for i, d in enumerate(reach):
                truth = gold.ledger.as_of(d.object_id, d.attribute, valid_at=gm.meeting.occurred_at + 86_400_000_000 - 1)
                before = gold.ledger.as_of(d.object_id, d.attribute, valid_at=gm.meeting.occurred_at - 1)
                if i in matched:
                    kind = "TP"
                elif truth is None:
                    kind = "no_gold_value_yet"
                elif values_equal(truth.value, d.value):
                    kind = "agrees"
                elif before is not None and values_equal(before.value, d.value):
                    kind = "earlier_value"
                else:
                    kind = "other_value"
                turn = gm.meeting.turns[d.turn]
                rows.append({"meeting": gm.meeting.meeting_id, "turn": d.turn, "speaker": turn.speaker, "slot": d.object_id, "value": d.value,
                             "class": kind, "changes_belief": d.changes_belief, "confidence": d.candidate.confidence,
                             "quote": d.candidate.quote[:200], "turn_text": turn.text[:300], **flags(chain, d.object_id, d.value, turn.text)})
    return rows, misses


def table(rows, misses):
    out = ["| meeting | turn | slot = value | class | changes | flags | quote |", "|---|---|---|---|---|---|---|"]
    for r in rows:
        f = ",".join(k for k in ("question", "hedge", "conditional", "names_item", "names_value", "names_other_item") if r[k])
        out.append(f"| {r['meeting']} | {r['turn']} | {r['slot']} = {r['value']} | {r['class']} | {'yes' if r['changes_belief'] else ''} | {f} | {r['quote'].replace('|', '/')} |")
    out += ["", "| missed | turn | slot = value | kind | gold quote |", "|---|---|---|---|---|"]
    out += [f"| {m['meeting']} | {m['turn']} | {m['slot']} = {m['value']} | {m['kind']} | {m['gold_quote'].replace('|', '/')} |" for m in misses]
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    args = sys.argv[1:]
    md = None
    if "--md" in args:
        at = args.index("--md")
        md = HERE / args[at + 1]
        del args[at:at + 2]
    rows, misses = audit(*args[:3])
    counts = Counter(r["class"] for r in rows)
    print(json.dumps({"writes": len(rows), "classes": counts, "changing": Counter(r["class"] for r in rows if r["changes_belief"]),
                      "misses": len(misses),
                      "flags_by_class": {c: dict(Counter(k for r in rows if r["class"] == c for k in ("question", "hedge", "conditional", "names_item", "names_value", "names_other_item") if r[k])) for c in counts}},
                     indent=1, default=str))
    if md:
        md.parent.mkdir(parents=True, exist_ok=True)
        md.write_text(table(rows, misses))
