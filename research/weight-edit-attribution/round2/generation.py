"""Actual extraction output with native versus generated evidence-first JSON fields."""
import json
import re
import resource
import signal
import statistics
import sys
import time
from types import SimpleNamespace

from r2_common import HERE, R1, REVISION, harness, load_dev, sha, verify_round1, write_json
from experiment import Runtime, preflight, timeout
from memoria_engine.extractors import SCHEMA, parse_events
from memoria_engine.pipeline import ObjectSpec, Registry
from temporal_service import repaired

EVIDENCE_SCHEMA = SCHEMA.replace('"object_id":', '"subject_turn":<int>,"subject_quote":"<exact component or antecedent words>","value_quote":"<exact value evidence words>","object_id":')
PROCEDURE = """For each event, GENERATE the source-evidence fields before selecting its registry ID:
1. subject_turn and subject_quote identify the exact component or its referent. Copy subject_quote from that transcript turn, not from the registry.
2. value_quote copies the words that support this property's value from the main quote.
3. Only after those fields, map that component/property to object_id and attribute. A component absent from the registry must be omitted or use object_id null and unresolved true, even if its material is an allowed value of another component.
Generate every genuinely adopted change in chronological order. Two real changes in one meeting remain two events; repeated old-value recaps do not outvote a later decision.
"""


def procedure_prompt(prompt, condition):
    if condition == "base":
        return prompt
    assert condition == "subject-first"
    anchor = "Now the real task. Reply with JSON only, in this shape:"
    assert SCHEMA in prompt and anchor in prompt
    return prompt.replace(SCHEMA, EVIDENCE_SCHEMA).replace(anchor, PROCEDURE + "\n" + anchor)


def configuration(rt, prompt, system, condition):
    prompt = procedure_prompt(prompt, condition)
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
    rendered = rt.tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    config = {"revision": REVISION, "condition": condition, "prompt_sha256": sha(rendered),
              "procedure_sha256": sha(PROCEDURE+EVIDENCE_SCHEMA) if condition == "subject-first" else "native",
              "max_tokens": 1800, "temperature": 0, "thinking": False, "intervention": "none"}
    return rendered, config


def request(rt, prompt, system, condition, tag):
    from mlx_lm import stream_generate
    from mlx_lm.sample_utils import make_sampler
    rendered, config = configuration(rt, prompt, system, condition)
    rt.reset()
    rt.mx.reset_peak_memory()
    started, text, last, cut = time.perf_counter(), "", None, False
    stream = stream_generate(rt.model, rt.tok, prompt=rendered, max_tokens=1800, sampler=make_sampler(temp=0))
    try:
        for response in stream:
            text += response.text
            last = response
            stopped = harness.cut_at_repeat(text)
            if stopped is not None:
                text, cut = stopped, True
                break
    finally:
        stream.close()
    row = {"id": tag, "key": sha(json.dumps(config, sort_keys=True)), "config": config, "condition": condition,
           "text": text, "seconds": time.perf_counter()-started, "prompt_tokens": last.prompt_tokens if last else 0,
           "output_tokens": last.generation_tokens if last else 0, "hit_budget": bool(last and last.generation_tokens >= 1800),
           "cut_repeat": cut, "peak_gb": rt.mx.get_peak_memory()/1e9}
    rt.reset()
    return row


def registry(case, chains):
    original = chains[case["meeting"][:-1]].registry
    if case["kind"] == "natural":
        return original
    objects = dict(original.objects)
    objects.pop("button_material", None)
    if case["dual_tracked"]:
        target = objects[case["target_id"]]
        objects[case["other_id"]] = ObjectSpec(case["other_id"], "decision", "Button component property", target.attributes)
    return Registry(objects, original.people)


def norm(text):
    return re.sub(r"\s+", " ", str(text).casefold()).strip()


def score_output(case, row, reg):
    candidates, clean = parse_events(row["text"])
    source = {t["index"]: t["text"] for t in case["source"]}
    found, wrong, invalid, ungrounded, unresolved, duplicates = set(), [], [], [], 0, 0
    seen = set()
    for candidate in candidates:
        if candidate.object_id is None or candidate.unresolved:
            unresolved += 1
            continue
        fixed = repaired(candidate, reg)
        if fixed is None or fixed.object_id not in reg.objects:
            invalid.append(vars(candidate))
            continue
        quoted = norm(fixed.quote)
        grounded = fixed.turn in source and quoted and quoted in norm(source[fixed.turn])
        if not grounded:
            ungrounded.append(vars(fixed))
        matches = [i for i, e in enumerate(case["expected"]) if fixed.turn == e["turn"] and
                   fixed.object_id == e["object_id"] and fixed.attribute == e["attribute"] and
                   norm(fixed.value) == norm(e["value"]) and norm(e["value_word"]) in quoted and grounded]
        key = (fixed.turn, fixed.object_id, fixed.attribute, str(fixed.value), fixed.quote)
        if key in seen:
            duplicates += 1
        seen.add(key)
        if matches:
            found.update(matches)
        else:
            wrong.append(vars(fixed))
    evidence_total = evidence_valid = 0
    try:
        doc = json.loads(row["text"][row["text"].find("{"):row["text"].rfind("}")+1])
        for event in doc.get("events", []):
            if event.get("object_id") is None or event.get("unresolved") is True:
                continue
            evidence_total += 1
            subject = norm(event.get("subject_quote", ""))
            value = norm(event.get("value_quote", ""))
            evidence_valid += bool(subject and value and event.get("subject_turn") in source and
                                   subject in norm(source[event["subject_turn"]]) and value in norm(event.get("quote", "")))
    except (ValueError, TypeError, AttributeError):
        pass
    return {"id": case["id"], "split": case["split"], "kind": case["kind"], "condition": row["condition"],
            "expected": len(case["expected"]), "found": len(found), "missing": [e for i, e in enumerate(case["expected"]) if i not in found],
            "wrong_writes": len(wrong), "wrong_details": wrong, "invalid": len(invalid), "invalid_details": invalid,
            "ungrounded": len(ungrounded), "ungrounded_details": ungrounded, "unresolved": unresolved,
            "duplicate_events": duplicates, "parsed_cleanly": clean, "evidence_fields_valid": evidence_valid,
            "evidence_fields_total": evidence_total,
            "success": len(found) == len(case["expected"]) and not wrong and not invalid and not ungrounded and clean,
            "seconds": row["seconds"], "tokens": row["output_tokens"], "peak_gb": row["peak_gb"]}


def run(conditions):
    verify_round1()
    check = preflight()
    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(450)
    rt = Runtime()
    cases = json.loads((HERE / "data/cases.json").read_text())
    path = HERE / "results/generation.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    done = [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []
    known = {r["key"] for r in done}
    try:
        for condition in conditions:
            for case in cases:
                _, config = configuration(rt, case["prompt"], case["system"], condition)
                if sha(json.dumps(config, sort_keys=True)) in known:
                    continue
                if time.perf_counter()-rt.started > 390:
                    print("lease boundary; complete records persisted", flush=True)
                    return
                row = request(rt, case["prompt"], case["system"], condition, case["id"])
                with path.open("a") as out:
                    out.write(json.dumps(row, ensure_ascii=False)+"\n")
                print(json.dumps({k: row[k] for k in ("id", "condition", "seconds", "output_tokens")}), flush=True)
    finally:
        rt.close()
        signal.alarm(0)
        print(json.dumps({"closed": True, "preflight": check, "seconds": time.perf_counter()-rt.started,
                          "peak_process_rss_gb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1e9}), flush=True)


def score():
    raw = (HERE / "results/generation.jsonl").read_bytes()
    raw = raw[:raw.rfind(b"\n")+1]
    snapshot = HERE / f"data/generation-{sha(raw)[:12]}.jsonl"
    if not snapshot.exists():
        snapshot.write_bytes(raw)
    rows = [json.loads(line) for line in snapshot.read_text().splitlines()]
    cases = {c["id"]: c for c in json.loads((HERE / "data/cases.json").read_text())}
    chains = {c.chain_id: c for c in load_dev()}
    scores = [score_output(cases[r["id"]], r, registry(cases[r["id"]], chains)) for r in rows]
    summary = {}
    for condition in sorted({r["condition"] for r in scores}):
        summary[condition] = {}
        for split in ("derive", "check", "all"):
            part = [r for r in scores if r["condition"] == condition and (split == "all" or r["split"] == split)]
            summary[condition][split] = {"cases": len(part), "successful_cases": sum(r["success"] for r in part),
                **{k: sum(r[k] for r in part) for k in ("expected", "found", "wrong_writes", "invalid", "ungrounded", "tokens", "evidence_fields_valid", "evidence_fields_total")},
                "unclean": sum(not r["parsed_cleanly"] for r in part), "seconds": sum(r["seconds"] for r in part),
                "median_seconds": statistics.median(r["seconds"] for r in part) if part else None,
                "peak_mlx_gb": max((r["peak_gb"] for r in part), default=None)}
    result = {"snapshot": str(snapshot.relative_to(HERE)), "snapshot_sha256": sha(raw), "summary": summary, "cases": scores}
    write_json(HERE / f"results/generation-summary-{sha(raw)[:12]}.json", result)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    score() if sys.argv[1] == "score" else run(sys.argv[1:])
