"""Topic-scoped verification: does showing the auditor only the decisions that matter help, or hurt?

THE QUESTION
  The proposal: tag every decision with a topic, find the topic of each utterance, let the auditor see only memory on
  that topic (plus money and schedule limits when the utterance touches them), so that a conversation that jumps across
  many topics cannot confuse it. The claim is that without this the auditor "gets confused and hallucinates alerts".

WHAT IS TESTED
  M2  the auditor as it is: memoria.audit, its prompt, its model, reading the whole memory.
  M3  the same auditor, reading a scope: the k decisions most similar to the statement (bge-small on the CPU), plus,
      when the statement mentions money or time, the m = 2 most similar money/time decisions (the "cross-topic
      dependency" of the proposal). decisions.md is not touched: a "[Topic: x]" tag between the citation and the text
      stops approve_decision from replacing the old decision (tested), so the topic is found at read time, not written.

CONDITIONS (the memory the auditor may read, per series)
  C0  its own decisions, as in Table 6.1 (about 12 decisions).
  C1  own decisions + 30 decisions on other topics.
  C2  own decisions + up to 150 decisions on other topics (nested: C1 is part of C2).
  "Other topics" are decisions of the other test series that share no keyword attribute (generate_bench.KEYWORD) and no
  specific word (first four letters, grammatical words and words in 10% of all decisions ignored) with the series' own
  decisions or with its 12 probes. So no distractor can support, contradict or replace anything a probe says, and
  the gold labels stay valid. The filter is a regular expression, not an embedding, so the scoper cannot exploit it.
  Distractors are in the same domain (remote controls), the hard case; they are shuffled with the own decisions.

PRE-REGISTERED ENDPOINTS (series are the unit for every interval; 95% paired cluster bootstrap, 2000 draws)
  E1  at C0, Macro-F1 of M3 minus M2. Scoping "preserves accuracy" iff the lower bound is above -0.05. Also the
      differences in alert recall and false-alarm rate, and McNemar (exact) on the alert decision.
  E2  prompt tokens and latency, M3 against M2 at each condition (P50, P95, ratio of medians). "Faster" iff the median
      latency of M3 is below 0.9 times that of M2 at C0.
  E3  scope recall: of the probes that have a gold decision (SUPPORTED_CURRENT, OUTDATED, CONTRADICTS), the share whose
      gold decision is inside the scope, by condition and class, and for k = 1..8 with and without the money/time rule.
  E4  scale: Macro-F1 of M2 at C1 and C2 minus M2 at C0 ("unscoped degrades" iff the interval is wholly below 0),
      and of M3 minus M2 at C1 and C2 ("scoping helps at scale" iff the interval is wholly above 0).
  E5  citations: among the true alerts, the share that cite the gold decision (reply read with a corrected parser) and
      the number of alerts that cite a distractor, which is the clearest case of one topic mixed up with another.
  E6  one LLM call that names the topic of a statement, timed on 30 statements, against the embedding step. Latency
      only: it says nothing about accuracy.
  Anything the data do not support is reported as "no evidence", and every endpoint is reported whatever it shows.

CHOICES FIXED BEFORE ANY TEST RUN
  k is the smallest of 2..6 whose scope recall on the development series (5 series, 60 probes) is at least 0.95, else 6.
  m = 2. The money/time pattern (MONEY_TIME), the condition sizes, the seed, the embedder and the filter are those
  of this file. Nothing is tuned on the test set. The hash of this file and of run_scoping.py is written to
  results/scoping/preregistration.json before the first test run, and the report says if either has changed since.

NOT TESTED
  Implicit dependencies ("titanium" needs the budget): MemoriaBench has no probe of that kind. Memory is one project's
  decisions: a vault that mixes projects needs a project scope first, which is metadata, not a topic. Distractors are
  other groups' decisions about the same product, not a month of real meetings.
"""

import random
import re
from collections import Counter
from pathlib import Path

import numpy as np

import generate_bench as G

HERE = Path(__file__).resolve().parent
SEED = 20261016
K_GRID = tuple(range(1, 9))
K_CHOICES = (2, 3, 4, 5, 6)
K_RECALL_TARGET = 0.95
EXTRA = 2  # money/time decisions added when the statement mentions money or time
CONDITIONS = {"C0": 0, "C1": 30, "C2": 150}  # distractors per series
GENERIC_SHARE = 0.10
STEM = 4

MEMORY_LINE = re.compile(r"^- \[([^\]]+)\] (.+)$")
MONEY_TIME = re.compile(
    r"\b(?:cost\w*|pric\w*|sell\w*|sold|budget\w*|cap|profit\w*|euros?|dollars?|pounds?|million|cheap\w*|expensive|afford\w*|spend\w*|money|"
    r"deadline\w*|launch\w*|quarter\w*|schedul\w*)\b|[€$£]|\d", re.I)
STOPWORDS = frozenset("that with will have this from they their there been were would could should about which when what into also then than them these those "
                      "after before being other more most some such only over very just like make made need needs want wants must".split())


# --- reading a memory -------------------------------------------------------------------------------------------

def parse_memory(text: str) -> list[dict]:
    """The decisions of a decisions.md, in file order: {id, text, line}. id is what sits in the brackets, without them."""
    items = []
    for line in text.splitlines():
        match = MEMORY_LINE.match(line.rstrip())
        if match:
            items.append({"id": match.group(1), "text": match.group(2), "line": line.rstrip()})
    return items


def has_cue(text: str) -> bool:
    """True when a statement or a decision mentions money or time."""
    return bool(MONEY_TIME.search(text))


# --- choosing the scope ------------------------------------------------------------------------------------------

def select(sims: np.ndarray, constraint: np.ndarray, cue: bool, k: int, extra: int = EXTRA, rule: bool = True) -> list[int]:
    """Indices of the decisions the auditor may see, in memory order: the k most similar, and, if the statement mentions money
    or time (and the rule is on), the `extra` most similar money/time decisions that are not already in."""
    order = np.argsort(-np.asarray(sims, dtype=float), kind="stable")
    chosen = [int(i) for i in order[:max(k, 0)]]
    if rule and cue:
        chosen += [int(i) for i in order if constraint[i] and int(i) not in chosen][:extra]
    return sorted(chosen)


class Scoper:
    """Decides, for a series and a statement, which of that series' decisions the auditor reads."""

    def __init__(self, embedder, memories: dict[str, list[dict]], k: int, extra: int = EXTRA, rule: bool = True) -> None:
        self.embedder, self.memories, self.k, self.extra, self.rule = embedder, memories, k, extra, rule
        self.vectors = {name: embedder.encode([i["text"] for i in items]) for name, items in memories.items()}
        self.constraint = {name: np.array([has_cue(i["text"]) for i in items], dtype=bool) for name, items in memories.items()}

    def scope(self, series: str, statement: str, query: np.ndarray | None = None) -> dict:
        items = self.memories[series]
        if not items:
            return {"indices": [], "ids": [], "text": "", "cue": has_cue(statement), "added": 0}
        query = self.embedder.encode([statement])[0] if query is None else query
        sims = self.vectors[series] @ query
        cue = has_cue(statement)
        base = select(sims, self.constraint[series], False, self.k, self.extra, self.rule)
        chosen = select(sims, self.constraint[series], cue, self.k, self.extra, self.rule)
        return {"indices": chosen, "ids": [items[i]["id"] for i in chosen], "text": "\n".join(items[i]["line"] for i in chosen), "cue": cue, "added": len(chosen) - len(base)}


def scope_recall(rows: list[dict]) -> dict:
    """Of the probes that have a gold decision, the share whose gold decision is in the scope. Rows carry gold_citation and
    scope_ids; an unscoped system has the whole memory as its scope."""
    have = [r for r in rows if r.get("gold_citation")]
    found = [r for r in have if r["gold_citation"].strip("[]") in set(r["scope_ids"])]
    by_class = {}
    for label in sorted({r["gold_label"] for r in have}):
        mine = [r for r in have if r["gold_label"] == label]
        by_class[label] = sum(r["gold_citation"].strip("[]") in set(r["scope_ids"]) for r in mine) / len(mine)
    return {"n": len(have), "found": len(found), "recall": len(found) / len(have) if have else float("nan"), "by_class": by_class}


def tune_k(recalls: dict[int, float]) -> int:
    """The pre-registered rule: the smallest k in K_CHOICES whose development scope recall reaches the target, else the largest."""
    for k in K_CHOICES:
        if recalls.get(k, 0.0) >= K_RECALL_TARGET - 1e-12:
            return k
    return K_CHOICES[-1]


# --- other-topic memory ------------------------------------------------------------------------------------------

def stems(text: str) -> set[str]:
    """First four letters of every word of four letters or more that is not a grammatical word: a crude, conservative stem."""
    return {w[:STEM] for w in re.findall(r"[a-z]{4,}", text.lower()) if w not in STOPWORDS}


def generic_stems(texts: list[str], share: float = GENERIC_SHARE) -> set[str]:
    document_frequency: Counter = Counter()
    for text in texts:
        document_frequency.update(stems(text))
    return {s for s, count in document_frequency.items() if texts and count / len(texts) >= share}


def attributes(text: str) -> set[str]:
    """The keyword attributes of generate_bench (power, material, chip, price, ...) that a text mentions."""
    return {a for a in G.KEYWORD if G.mentions(a, text)}


def admissible(text: str, own_attributes: set[str], own_stems: set[str], generic: set[str]) -> bool:
    """A decision on another topic: no attribute and no specific word in common with the series."""
    if attributes(text) & own_attributes:
        return False
    return not ((stems(text) - generic) & own_stems)


def series_profile(own: list[dict], statements: list[str], generic: set[str]) -> tuple[set[str], set[str]]:
    texts = [i["text"] for i in own] + list(statements)
    return set().union(*(attributes(t) for t in texts)), set().union(*(stems(t) for t in texts)) - generic


def distractor_pool(series: str, memories: dict[str, list[dict]], statements: dict[str, list[str]], generic: set[str]) -> list[dict]:
    """Every decision of the other series that is admissible for this one, in a fixed order."""
    own_attributes, own_stems = series_profile(memories[series], statements.get(series, []), generic)
    return [{**item, "source": name} for name in sorted(memories) if name != series for item in memories[name]
            if admissible(item["text"], own_attributes, own_stems, generic)]


def build_memory(series: str, condition: str, memories: dict[str, list[dict]], statements: dict[str, list[str]], generic: set[str]) -> tuple[str, dict]:
    """The decisions.md the auditor reads in a condition, and what went into it. C0 is the series' own memory, unchanged."""
    own = memories[series]
    if condition == "C0":
        return "".join(i["line"] + "\n" for i in own), {"own": len(own), "distractors": 0, "pool": None, "ids": [i["id"] for i in own]}
    pool = distractor_pool(series, memories, statements, generic)
    biggest = CONDITIONS["C2"]
    c2 = pool if len(pool) <= biggest else random.Random(G.stable(SEED, "pick", series)).sample(pool, biggest)
    mixed = list(c2)
    random.Random(G.stable(SEED, "nest", series)).shuffle(mixed)
    picked = mixed[:CONDITIONS["C1"]] if condition == "C1" else mixed
    lines = [i["line"] for i in own] + [i["line"] for i in picked]
    random.Random(G.stable(SEED, "order", series, condition)).shuffle(lines)
    ids = [MEMORY_LINE.match(line).group(1) for line in lines]
    return "\n".join(lines) + "\n", {"own": len(own), "distractors": len(picked), "pool": len(pool), "ids": ids, "distractor_ids": [i["id"] for i in picked]}


# --- reading a reply ---------------------------------------------------------------------------------------------

def cited_id(raw: str, known: list[str]) -> str:
    """The decision a reply cites, as [id]. memoria._parse takes the first known id that is a substring of the citation, so a
    reply that cites [X:27:06#3] comes back as [X:27:06] whenever that shorter id sits earlier in the file. This takes the id in
    the brackets exactly, and only falls back to the longest id found in the text."""
    parts = [p.strip() for p in " ".join(raw.split()).split("|", 2)]
    cited = parts[2] if len(parts) > 2 else " ".join(parts[1:])
    for group in re.findall(r"\[([^\[\]]+)\]", cited):
        if group.strip() in known:
            return f"[{group.strip()}]"
    inside = [c for c in known if c in cited]
    return f"[{max(inside, key=len)}]" if inside else ""
