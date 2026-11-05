"""Post-hoc analyses of the topic-scoping experiment. NOT pre-registered: they were added after the pre-registered results were seen, to understand
them, and the summary says so. Nothing here changes a pre-registered verdict.

    python3.11 scoping_posthoc.py [--audit DIR] [--no-retrieval]

  1. class recall of every system, and where the probes of M2 moved from C0 to C2,
  2. is the loss of M2 at C1 and C2 an artifact of the other-topic memory?  (a) the probes whose statement shares a very common word ('button',
     'control') with a distractor, which the filter let through; (b) a blind second labeller who read each probe against the C2 memory: the
     share of gold labels it confirms, the probes whose label would change, and the loss of M2 on the probes it confirms,
  3. why the scope misses: scope recall of dense, BM25 and hybrid (reciprocal-rank fusion) retrieval at k = 4 and 8 on each condition
     (BM25 is favoured here: the other-topic decisions were chosen to share no word with the probes, so lexical overlap separates them),
  4. the interleaved latency measurement (latency_paired.py).
Writes results/scoping/posthoc_summary.txt and posthoc_results.json.
"""

import argparse
import json
import math
import sys
from collections import Counter
from pathlib import Path

import numpy as np

import eval_metrics as E
import run_benchmarks as R
import run_scoping as RS
import scoping as S

OUT = RS.OUT
SHORT = {"SUPPORTED_CURRENT": "SUPP", "OUTDATED": "OUTD", "CONTRADICTS": "CONT", "UPDATES": "UPDA", "IRRELEVANT": "IRRE", "INSUFFICIENT_EVIDENCE": "INSU"}
COMMON = ("butt", "cont")  # the common stems that can carry a topic; 'remo' is the template of every decision and 'repl' the notes
BM25_STOP = frozenset("that with will have this from they their there been were would could should about which when what into also then than them these those after "
                      "before being other more most some such only over very just like make made need needs want wants must the and for are but not can its our remote remotes".split())


# --- 1. classes ------------------------------------------------------------------------------------------------

def class_recall(rows: list[dict]) -> dict[str, float]:
    return E.scores(E.confusion_matrix(rows))["class_recall"]


def movement(rows_a: list[dict], rows_b: list[dict]) -> dict:
    """Where the labels of the probes moved from a to b: counts of (gold, label in a, label in b), and how many became right or wrong."""
    by_a = {r["id"]: r for r in rows_a}
    moved = Counter()
    right = wrong = 0
    for b in rows_b:
        a = by_a[b["id"]]
        right += b["pred"] == b["gold_label"] and a["pred"] != b["gold_label"]
        wrong += b["pred"] != b["gold_label"] and a["pred"] == b["gold_label"]
        if a["pred"] != b["pred"]:
            moved[(b["gold_label"], a["pred"], b["pred"])] += 1
    return {"changed": sum(moved.values()), "became_right": right, "became_wrong": wrong, "moves": moved.most_common()}


# --- 2a. common-word exposure ---------------------------------------------------------------------------------------

def exposure(rows: list[dict], distractor_texts: dict[str, list[str]], common: tuple[str, ...] = COMMON) -> dict[str, bool]:
    """A probe is exposed when its statement shares a common stem (button, control) with a decision that was added to its memory as another
    topic: the filter does not look at those words, because nearly every decision has them."""
    out = {}
    for r in rows:
        mine = S.stems(r["statement"]) & set(common)
        out[r["id"]] = bool(mine) and any(S.stems(t) & mine for t in distractor_texts.get(r["series_id"], []))
    return out


def subset_scores(rows: list[dict], keep) -> dict:
    sub = [r for r in rows if keep(r["id"])]
    s = E.scores(E.confusion_matrix(sub)) if sub else {"macro_f1": math.nan, "accuracy": math.nan, "alert_recall": math.nan}
    return {"n": len(sub), "macro_f1": s["macro_f1"], "accuracy": s["accuracy"], "alert_recall": s["alert_recall"]}


# --- 2b. the blind second labeller --------------------------------------------------------------------------------------

def read_audit(folder: Path, mapping: dict | None = None) -> dict[str, dict]:
    """The labeller's answers by probe id. In the blind round the labeller saw only anonymous ids ("set_03/s07", "d017"); the mapping, kept
    apart from it, turns them back into probe ids and real decision ids. A key without a mapping is taken to be a probe id already."""
    labels = {}
    for path in sorted(folder.glob("*labels_group*.json")):
        for key, value in json.loads(path.read_text(encoding="utf-8")).items():
            if mapping is not None and "/" in key:
                set_id, statement = key.split("/", 1)
                entry = mapping["sets"].get(set_id)
                if not entry or statement not in entry["statements"]:
                    continue
                key = entry["statements"][statement]
                value = {**value, "decisions_used": [entry["decisions"].get(d, d) for d in value.get("decisions_used", [])]}
            labels[key] = value
    return labels


def audit_agreement(labels: dict[str, dict], probes: list[dict], distractors: dict[str, set[str]]) -> dict:
    """The blind labeller against the gold labels: agreement, by class, the disagreements, and the probes whose label rests on a decision that
    was added as another topic's."""
    gold = {p["id"]: p for p in probes}
    valid = {k: v for k, v in labels.items() if k in gold and v.get("label") in E.CLASSES}
    agree = {i for i, v in valid.items() if v["label"] == gold[i]["gold_label"]}
    per_class = {c: f"{sum(1 for i in agree if gold[i]['gold_label'] == c)}/{sum(1 for p in probes if p['gold_label'] == c)}" for c in E.CLASSES}
    relied = sorted(i for i, v in valid.items() if set(v.get("decisions_used", [])) & distractors.get(gold[i]["series_id"], set()))
    return {"labelled": len(valid), "missing": sorted(set(gold) - set(valid)), "agree": len(agree), "per_class": per_class,
            "disagreements": sorted((i, gold[i]["gold_label"], v["label"], v.get("note", "")) for i, v in valid.items() if i not in agree),
            "relied_on_distractor": relied, "agreeing_ids": sorted(agree)}


# --- 3. retrieval ---------------------------------------------------------------------------------------------------

def tokens(text: str) -> list[str]:
    import re
    return [w for w in re.findall(r"[a-z]{3,}", text.lower()) if w not in BM25_STOP]


def bm25(query: list[str], docs: list[list[str]], k1: float = 1.5, b: float = 0.75) -> np.ndarray:
    n, df = len(docs), Counter()
    for d in docs:
        df.update(set(d))
    average = sum(len(d) for d in docs) / max(n, 1)
    scores = np.zeros(n)
    for word in set(query):
        if word not in df:
            continue
        idf = math.log(1 + (n - df[word] + 0.5) / (df[word] + 0.5))
        for i, d in enumerate(docs):
            f = d.count(word)
            if f:
                scores[i] += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * len(d) / average))
    return scores


def ranking(scores: np.ndarray) -> list[int]:
    return [int(i) for i in np.argsort(-scores, kind="stable")]


def fuse(*rankings: list[int], k: int = 60) -> list[int]:
    """Reciprocal-rank fusion: a decision's score is the sum over rankings of 1 / (k + position)."""
    score: Counter = Counter()
    for r in rankings:
        for position, i in enumerate(r):
            score[i] += 1 / (k + position + 1)
    return sorted(score, key=lambda i: (-score[i], i))


def retrieval_recall(embedder, memories: dict[str, list[dict]], probes: list[dict], ks: tuple[int, ...] = (4, 8)) -> dict:
    """Of the probes with a gold decision: how many have it in the top k of dense, BM25 and hybrid retrieval."""
    gold = [p for p in probes if p["gold_citation"]]
    vectors = {s: embedder.encode([i["text"] for i in items]) for s, items in memories.items()}
    docs = {s: [tokens(i["text"]) for i in items] for s, items in memories.items()}
    queries = embedder.encode([p["statement"] for p in gold])
    found = {k: {"dense": 0, "bm25": 0, "hybrid": 0} for k in ks}
    for q, p in zip(queries, gold):
        s, wanted = p["series_id"], p["gold_citation"].strip("[]")
        dense = ranking(vectors[s] @ q)
        lexical = ranking(bm25(tokens(p["statement"]), docs[s]))
        hybrid = fuse(dense, lexical)
        for k in ks:
            for name, order in (("dense", dense), ("bm25", lexical), ("hybrid", hybrid)):
                found[k][name] += wanted in {memories[s][i]["id"] for i in order[:k]}
    return {"n": len(gold), "found": found}


# --- 4. latency -----------------------------------------------------------------------------------------------------

def read_paired(folder: Path) -> dict[str, dict]:
    return {path.name.split(".")[0]: json.loads(path.read_text(encoding="utf-8")) for path in sorted(folder.glob("C*.summary.json"))}


# --- the text ------------------------------------------------------------------------------------------------------

def pct(x: float) -> str:
    return "n/a" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{100 * x:.0f}%"


def describe(result: dict) -> str:
    out = ["POST-HOC ANALYSES OF THE TOPIC-SCOPING EXPERIMENT", "=" * 52, "",
           "These were added AFTER the pre-registered results were seen, to understand them. They change no pre-registered verdict and are exploratory.", ""]
    out += ["1. RECALL BY CLASS (% of the 56 probes of a class that got that class)", "-" * 52, f"{'':8}" + "".join(f"{SHORT[c]:>7}" for c in E.CLASSES)]
    for system, r in result["class_recall"].items():
        out.append(f"{system:8}" + "".join(f"{100 * r[c]:>7.0f}" for c in E.CLASSES))
    m = result.get("movement_m2_c0_c2")
    if m:
        out.append("")
        out.append(f"M2 from C0 to C2: {m['changed']} probes changed label, {m['became_right']} became right and {m['became_wrong']} wrong. Largest moves (gold: C0 label -> C2 label): "
                   + "; ".join(f"{SHORT[g]}: {SHORT[a]} -> {SHORT[b]} x{n}" for (g, a, b), n in m["moves"][:6]) + ".")
        swaps = sum(n for (g, a, b), n in m["moves"] if {a, b} == {"OUTDATED", "CONTRADICTS"})
        out.append(f"{swaps} of those moves are OUTDATED and CONTRADICTS taken for each other: both are alerts, so the alert still fires and only the label differs.")
    out += ["", "2. IS THE LOSS OF M2 AT SCALE AN ARTIFACT OF THE OTHER-TOPIC MEMORY?", "-" * 52]
    e = result.get("exposure")
    if e:
        out.append(f"(a) The filter ignores words that nearly every decision has. {e['exposed']} of 336 probes share 'button' or 'control' with a distractor in C2. Without them ({e['unexposed']} probes), "
                   f"M2 goes from Macro-F1 {e['M2@C0']['unexposed']['macro_f1']:.2f} at C0 to {e['M2@C2']['unexposed']['macro_f1']:.2f} at C2 and alert recall from {e['M2@C0']['unexposed']['alert_recall']:.2f} to {e['M2@C2']['unexposed']['alert_recall']:.2f}; "
                   f"with all probes: {e['M2@C0']['all']['macro_f1']:.2f} to {e['M2@C2']['all']['macro_f1']:.2f} and {e['M2@C0']['all']['alert_recall']:.2f} to {e['M2@C2']['all']['alert_recall']:.2f}.")
    a = result.get("audit")
    if a:
        out.append(f"(b) Blind audit: a second labeller (a language model that saw only the C2 memory and the class definitions, never the gold labels or any system's answer) labelled {a['labelled']} probes and "
                   f"agreed with the gold label on {a['agree']} ({pct(a['agree'] / max(a['labelled'], 1))}); at C0 the two earlier audits agreed on 334 and 336 of 336. By class: "
                   + ", ".join(f"{SHORT[c]} {v}" for c, v in a["per_class"].items()) + f". {len(a['relied_on_distractor'])} labels rest on a decision that was added as another topic's.")
        if a["disagreements"]:
            out.append("    Disagreements (probe, gold, blind label): " + "; ".join(f"{i} {SHORT[g]}/{SHORT[b]}" for i, g, b, _ in a["disagreements"][:20]) + (" ..." if len(a["disagreements"]) > 20 else ""))
        c = a.get("clean")
        if c:
            def line(kind: str) -> str:
                have = [(condition, c[f"{kind}@{condition}"]) for condition in ("C0", "C1", "C2") if f"{kind}@{condition}" in c]
                if not have:
                    return ""
                return (f"{kind} Macro-F1 " + ", ".join(f"{x['macro_f1']:.2f} at {condition}" for condition, x in have)
                        + " (alert recall " + ", ".join(f"{x['alert_recall']:.2f}" for _, x in have) + ")")

            out.append(f"    On the {c['n']} probes whose gold label the blind labeller confirms: " + "; ".join(t for t in (line("M2"), line("M3")) if t) + ".")
        lk = result.get("leaky_round")
        if lk:
            out.append(f"    A first round, whose probe ids carried the class letter and the series and whose decision ids named their source series (so it was not blind), agreed on {lk['agree']} of {lk['labelled']}; it is not used.")
    else:
        out.append("(b) The blind audit has not been read yet.")
    r = result.get("retrieval")
    out += ["", "3. WHY THE SCOPE MISSES (probes whose gold decision is in the top k; of %s with a gold decision)" % (r["C0"]["n"] if r else "168"), "-" * 52]
    if r:
        out.append(f"{'':6}{'k':>3}{'dense':>8}{'BM25':>8}{'hybrid':>8}")
        for condition, x in r.items():
            for k, f in x["found"].items():
                out.append(f"{condition:6}{k:>3}{f['dense']:>8}{f['bm25']:>8}{f['hybrid']:>8}")
        out.append("Dense retrieval (what M3 used) loses the decision more as memory grows. BM25 does better, but the comparison favours it: the other-topic decisions were chosen to share no word with the probes. "
                   "Treat it as a hint about what to try, not as a result.")
    out += ["", "4. LATENCY, INTERLEAVED (both systems in one process, alternating which goes first)", "-" * 52]
    for condition, s in result.get("paired", {}).items():
        out.append(f"{condition} on {s['probes']} probes: M3 P50 {s['p50_ms']['M3']:.0f} ms, M2 P50 {s['p50_ms']['M2']:.0f} ms; ratio of medians {s['ratio_of_medians']['ratio']:.2f} "
                   f"[{s['ratio_of_medians']['lo']:.2f}, {s['ratio_of_medians']['hi']:.2f}]; M3 faster on {pct(s['share_of_probes_where_m3_was_faster'])} of the probes; labels identical to the batch runs "
                   f"(M3 {s['same_label_as_batch_run']['M3']}, M2 {s['same_label_as_batch_run']['M2']}).")
    out.append("The batch runs timed M3@C0 while Memoria's author was streaming text on the same Mac, which is why their C0 ratio (see the main summary) is higher than this one.")
    out.append("")
    return "\n".join(out)


def analyse(rows: dict[str, list[dict]], conditions: dict, memories_c2: dict[str, list[dict]], probes: list[dict], audit: dict | None = None,
            retrieval: dict | None = None, paired: dict | None = None, leaky: dict | None = None) -> dict:
    result = {"class_recall": {system: class_recall(r) for system, r in rows.items()}}
    if "M2@C0" in rows and "M2@C2" in rows:
        result["movement_m2_c0_c2"] = movement(rows["M2@C0"], rows["M2@C2"])
        text = {s: {i["id"]: i["text"] for i in items} for s, items in memories_c2.items()}
        distractor_texts = {s: [text[s][d] for d in info["C2"]["distractor_ids"]] for s, info in conditions["series"].items()}
        exposed = exposure(rows["M2@C2"], distractor_texts)
        result["exposure"] = {"exposed": sum(exposed.values()), "unexposed": len(exposed) - sum(exposed.values())}
        for system in ("M2@C0", "M2@C2", "M3@C0", "M3@C2"):
            if system in rows:
                result["exposure"][system] = {"all": subset_scores(rows[system], lambda i: True), "exposed": subset_scores(rows[system], lambda i: exposed[i]),
                                              "unexposed": subset_scores(rows[system], lambda i: not exposed[i])}
    if audit:
        distractors = {s: set(info["C2"]["distractor_ids"]) for s, info in conditions["series"].items()}
        result["audit"] = audit_agreement(audit, probes, distractors)
        keep = set(result["audit"]["agreeing_ids"])
        result["audit"]["clean"] = {"n": len(keep), **{system: subset_scores(r, lambda i: i in keep) for system, r in rows.items()}}
    if leaky:
        gold = {p["id"]: p["gold_label"] for p in probes}
        result["leaky_round"] = {"labelled": len(leaky), "agree": sum(v.get("label") == gold.get(i) for i, v in leaky.items())}
    result["retrieval"] = retrieval or {}
    result["paired"] = paired or {}
    return result


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audit", type=Path, default=OUT / "audit")
    parser.add_argument("--leaky", type=Path, default=OUT / "audit_leaky" / "out")
    parser.add_argument("--mapping", type=Path, default=OUT / "audit_mapping.json")
    parser.add_argument("--no-retrieval", action="store_true")
    args = parser.parse_args(argv)
    import scoping_report as P

    rows, _ = P.load_runs(OUT / "_work")
    conditions = json.loads((OUT / "conditions.json").read_text(encoding="utf-8"))
    memories_c2 = RS.condition_memories("C2", "test")
    probes = R.read_lines(R.BENCH_FILE)
    mapping = json.loads(args.mapping.read_text(encoding="utf-8")) if args.mapping.exists() else None
    audit = read_audit(args.audit, mapping) if args.audit.exists() and list(args.audit.glob("*labels_group*.json")) else None
    leaky = read_audit(args.leaky) if args.leaky.exists() and list(args.leaky.glob("*labels_group*.json")) else None
    retrieval = {}
    if not args.no_retrieval:
        embedder = R.Embedder()
        for condition in ("C0", "C1", "C2"):
            retrieval[condition] = retrieval_recall(embedder, RS.condition_memories(condition, "test"), probes)
    result = analyse(rows, conditions, memories_c2, probes, audit, retrieval, read_paired(OUT / "_paired"), leaky)
    (OUT / "posthoc_results.json").write_text(json.dumps(result, indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o)), encoding="utf-8")
    text = describe(result)
    (OUT / "posthoc_summary.txt").write_text(text, encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
