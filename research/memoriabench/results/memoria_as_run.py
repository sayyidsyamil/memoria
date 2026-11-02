"""Memoria: audit live meeting statements against approved decisions.

The whole decisions.md goes straight into the prompt (no vector DB, no chunking).
Run: python3.11 memoria.py   (requires: pip install mlx-lm)
"""

import os
import re
import threading
import time
from functools import lru_cache
from pathlib import Path
from typing import TypedDict

from huggingface_hub.utils import disable_progress_bars
from mlx_lm import generate, load
from mlx_lm.sample_utils import make_sampler

MODEL = "mlx-community/Qwen3.5-4B-MLX-4bit"
DECISIONS_FILE = "decisions.md"
TEMPERATURE = 0.0
MAX_TOKENS = 60
PREFILL_STEP = 128  # prompt tokens per prefill pass: ~0.4 GB of activations instead of ~0.9 GB at the default 2048

LABELS = (
    "SUPPORTED_CURRENT",
    "OUTDATED",
    "CONTRADICTS",
    "UPDATES",
    "IRRELEVANT",
    "INSUFFICIENT_EVIDENCE",
)
ALERT_LABELS = ("OUTDATED", "CONTRADICTS")

SYSTEM_PROMPT = (
    "You are a strict meeting auditor. Compare the LIVE STATEMENT against the APPROVED DECISIONS "
    "and reply with the first class that fits."
)

# Sent before every statement: class rules, reply format, and examples on unrelated decisions.
CLASS_GUIDE = (
    "Classes, in order:\n"
    "1. IRRELEVANT: social chatter or logistics unrelated to the project (food, weather, sport, greetings), "
    "even when phrased as a suggestion.\n"
    '2. OUTDATED: still uses the old thing named in a decision\'s "(replaces ...)" note.\n'
    "3. CONTRADICTS: conflicts with an approved decision (a different value, material or market; "
    "a figure above a cap or budget; a different date, quarter or deadline, earlier or later).\n"
    "4. SUPPORTED_CURRENT: consistent with an approved decision (reaffirms it, or stays within its cap).\n"
    "5. UPDATES: suggests adding or changing something that no approved decision covers.\n"
    "6. INSUFFICIENT_EVIDENCE: any other claim about the project (progress, results, events) "
    "that the decisions cannot confirm or refute.\n"
    "For OUTDATED or CONTRADICTS reply exactly: CLASS | reason in under 12 words | [citation]\n"
    "For every other class reply with the class name only.\n"
    "Examples, using other decisions: [M1:02:00] Supplier is Acme (replaces Globex). "
    "[M1:03:00] Budget cap is strictly $50k. [M2:01:00] Release deadline is strictly March.\n"
    '"We\'ll keep ordering from Globex." -> OUTDATED | Acme replaced Globex | [M1:02:00]\n'
    '"The budget will reach $65k." -> CONTRADICTS | Exceeds the $50k budget cap | [M1:03:00]\n'
    '"The release will go out in June." -> CONTRADICTS | Conflicts with the March release deadline | [M2:01:00]\n'
    '"Acme is confirmed for the contract." -> SUPPORTED_CURRENT\n'
    '"Let\'s add a dark mode." -> UPDATES\n'
    '"Did anyone watch the match?" -> IRRELEVANT\n'
    '"The client loved the demo." -> INSUFFICIENT_EVIDENCE'
)

WINGMAN_SYSTEM_PROMPT = (
    "You are a live meeting wingman. Using only approved decisions, provide a 1-sentence tactical answer "
    "or objection counter with citation."
)
WINGMAN_MAX_TOKENS = 60
NO_ANSWER = "No approved decision covers that."
MAX_QUERY_CHARS = 1000

# Sent with every question. Its examples are about a mascot and a party on purpose: with examples about a
# supplier and a budget, a 4B model answered "Who is our supplier?" with a made-up reply that cited a real decision.
WINGMAN_GUIDE = (
    "Answer the QUESTION using only the approved decisions above.\n"
    "- Reply in one short sentence, two at most, and end with the citation of the decision you used, "
    "copied exactly, like [M1:02:00].\n"
    "- If the question proposes or assumes something that an approved decision settles differently, "
    "say what the decision says instead.\n"
    f"- If no approved decision covers the question, reply exactly: {NO_ANSWER}\n"
    "Examples, using unrelated decisions: [M1:02:00] Mascot is Pelican (replaces Otter). "
    "[M1:03:00] Party budget is strictly $50k.\n"
    '"What is the party budget?" -> The party budget is strictly $50k. [M1:03:00]\n'
    '"Can we bring back the Otter?" -> No, Pelican replaced Otter as the mascot. [M1:02:00]\n'
    f'"Who is bringing the cake?" -> {NO_ANSWER}'
)

TEST_STATEMENTS = [
    "The weather in KL is really hot today.",
    "We are still using the standard battery for the remote.",
    "The titanium case will cost 14 euros per unit.",
    "We agree kinetic charging is the way forward.",
]


def audit(model, tokenizer, decisions: str, statement: str) -> str:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"APPROVED DECISIONS:\n{decisions}\n\n{CLASS_GUIDE}\n\n"
                f"LIVE STATEMENT:\n{statement}"
            ),
        },
    ]
    prompt = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=False,  # otherwise Qwen3.5 spends the 60-token budget inside <think>
    )
    return generate(
        model,
        tokenizer,
        prompt=prompt,
        max_tokens=MAX_TOKENS,
        sampler=make_sampler(temp=TEMPERATURE),
        prefill_step_size=PREFILL_STEP,
    ).strip()


# MLX must not be driven from two threads at once (the HUD audits on one and answers on another), and the
# weights must load once rather than once per concurrent first call. Reentrant so that holders may load.
_model_lock = threading.RLock()


@lru_cache(maxsize=1)
def _load():
    disable_progress_bars()
    return load(MODEL)


def load_model():
    with _model_lock:
        return _load()


def _resolve(decisions_file: str) -> Path:
    # Relative paths are anchored to this script's folder, not the caller's working directory.
    return Path(__file__).parent / decisions_file


class AuditResult(TypedDict):
    alert: bool
    label: str
    reason: str
    citation: str
    latency_ms: float


def _known_citations(decisions: str) -> list[str]:
    """The ids of the decisions that exist, such as M3:14:02: the only citations anyone may be shown."""
    return re.findall(r"^\s*[-*]\s*\[([^\]]+)\]", decisions, flags=re.MULTILINE)


def _parse(raw: str, decisions: str) -> tuple[str, str, str]:
    """Turn the model's reply into (label, reason, citation) that always satisfies the contract."""
    label_part, *rest = (part.strip() for part in " ".join(raw.split()).split("|", 2))
    match = re.search("|".join(LABELS), re.sub(r"[\s-]+", "_", label_part.upper()))
    label = match.group() if match else "INSUFFICIENT_EVIDENCE"  # unreadable reply: raise no alarm
    if label not in ALERT_LABELS:
        return label, "", ""

    reason = re.sub(r"^\[([^\[\]]*)\]$", r"\1", rest[0]) if rest else ""
    reason = re.split(r"(?<=[.!?])\s+", reason)[0]
    cited = rest[1] if len(rest) > 1 else " ".join(rest)
    citation = next((f"[{c}]" for c in _known_citations(decisions) if c in cited), "")  # only ids that exist in memory
    return label, reason, citation


def format_result(result: AuditResult) -> str:
    """One terminal line: 'PASS | LABEL' or 'ALERT | LABEL | reason | citation'."""
    if not result["alert"]:
        return f"PASS | {result['label']}"
    return f"ALERT | {result['label']} | {result['reason']} | {result['citation']}"


def check_statement(statement: str, decisions_file: str = DECISIONS_FILE) -> AuditResult:
    with _model_lock:  # taken before the clock starts, so waiting for another caller is not counted as audit time
        model, tokenizer = load_model()  # one-time cost, kept out of latency_ms
        start = time.perf_counter()
        # Re-read the file on every call so edits on disk take effect immediately.
        decisions = _resolve(decisions_file).read_text(encoding="utf-8")
        label, reason, citation = _parse(audit(model, tokenizer, decisions, statement), decisions)
        return {
            "alert": label in ALERT_LABELS,
            "label": label,
            "reason": reason,
            "citation": citation,
            "latency_ms": (time.perf_counter() - start) * 1000,
        }


def _tidy_answer(raw: str, decisions: str) -> str:
    """Turn the model's reply into what the wingman may show: plain prose of at most two sentences, followed by
    citations that exist. A reply that cites no real decision is not an answer from memory, so it becomes NO_ANSWER."""
    text = " ".join(raw.replace("*", "").replace("`", "").split())
    if NO_ANSWER.rstrip(".").lower() in text.lower():
        return NO_ANSWER  # also when it was wrapped in an apology, or followed by an explanation
    known = _known_citations(decisions)
    cited = [c for c in dict.fromkeys(found.strip() for found in re.findall(r"\[([^\[\]]+)\]", text)) if c in known]
    prose = re.sub(r"\s+([,.;:!?])", r"\1", re.sub(r"\s*\[[^\[\]]*\]", "", text)).strip()
    prose = " ".join(re.split(r"(?<=[.!?])\s+", prose)[:2])
    if not prose or not cited:
        return NO_ANSWER
    return f"{prose} " + " ".join(f"[{c}]" for c in cited[:2])


def ask_assistant(query: str, decisions_file: str = DECISIONS_FILE) -> str:
    """Answer a question from the approved decisions in one or two sentences, ending with the citation it rests on.

    Reads memory and never writes it. If no decision covers the question, or the model's reply cannot be tied
    to a decision that exists, the answer is NO_ANSWER rather than a guess.
    """
    query = " ".join(query.split())
    if not query:
        raise ValueError("ask a question")
    if len(query) > MAX_QUERY_CHARS:
        raise ValueError(f"a question is at most {MAX_QUERY_CHARS} characters, this one has {len(query)}")
    decisions = active_decisions(decisions_file)
    if not decisions:
        return NO_ANSWER  # nothing is approved yet, so there is nothing to answer from

    messages = [
        {"role": "system", "content": WINGMAN_SYSTEM_PROMPT},
        {"role": "user", "content": f"APPROVED DECISIONS:\n{decisions}\n\n{WINGMAN_GUIDE}\n\nQUESTION:\n{query}"},
    ]
    with _model_lock:
        model, tokenizer = load_model()
        prompt = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True, enable_thinking=False  # else the budget goes on <think>
        )
        raw = generate(
            model,
            tokenizer,
            prompt=prompt,
            max_tokens=WINGMAN_MAX_TOKENS,
            sampler=make_sampler(temp=TEMPERATURE),
            prefill_step_size=PREFILL_STEP,
        )
    return _tidy_answer(raw, decisions)


def active_decisions(decisions_file: str = DECISIONS_FILE) -> str:
    """The approved decisions as markdown bullets, one per line, exactly as the auditor reads them."""
    lines = _resolve(decisions_file).read_text(encoding="utf-8").splitlines()
    return "\n".join(line.strip() for line in lines if re.match(r"\s*[-*]\s", line))


def approve_decision(
    topic: str,
    new_value: str,
    previous_value: str,
    citation: str,
    decisions_file: str = DECISIONS_FILE,
) -> None:
    """Replace any active entry on `topic` with the new decision and rewrite the file clean.

    With no new_value, topic is the whole entry: a plain statement such as a commitment.
    """
    path = _resolve(decisions_file)
    existing = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    topic = topic.strip().rstrip(".")
    # Matches "- [M2] Topic: value", the free-form "- [M2] Topic is value", and a whole-line "- [M2] Topic."
    same_topic = re.compile(rf"^[-*]\s*(?:\[[^\]]*\]\s*)?{re.escape(topic)}(?=\s*:|\s+is\b|\.?\s*$)", re.IGNORECASE)
    lines = (line.strip() for line in existing)
    active = [line for line in lines if line and not same_topic.match(line)]

    entry = f"- [{citation.strip()}] {topic}"
    if new_value.strip():
        entry += f": {new_value.strip().rstrip('.')}"
    if previous_value.strip():
        entry += f" (replaces {previous_value.strip().rstrip('.')})"
    active.append(entry + ".")
    # Another process (the MCP server) reads this file at any moment, so swap it in whole rather than
    # truncating it and writing: a reader sees the old file or the new one, never half of either.
    scratch = path.with_name(path.name + ".tmp")
    scratch.write_text("\n".join(dict.fromkeys(active)) + "\n", encoding="utf-8")
    os.replace(scratch, path)


if __name__ == "__main__":
    check_statement("warm up")  # keeps one-time model load and GPU warm-up out of the timings

    for i, statement in enumerate(TEST_STATEMENTS):
        result = check_statement(statement)
        if i:
            print()
        print(f'Spoken: "{statement}"')
        print(f"Result: {format_result(result)}  ({result['latency_ms']:.0f}ms)")
