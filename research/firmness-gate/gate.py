"""The firmness gate: one narrow YES/NO question per event the extractor proposes, scored by first-token log-odds.

score = log P(YES) - log P(NO) for the first answer token, asked of the Memoria app's running Qwen worker through
src-tauri/resources/memory/qwen_scoring.py (the scoring the live guard uses). An event is kept when score >= tau.
Every score is appended to a jsonl cache keyed by the exact messages, so a rerun needs no model.
"""
import hashlib
import importlib.util
import json
import os
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCORING = HERE.parents[1] / "src-tauri" / "resources" / "memory" / "qwen_scoring.py"
MODEL = "mlx-community/Qwen3.5-4B-MLX-4bit@32f3e8ecf65426fc3306969496342d504bfa13f3 (the app's resident worker)"

BEFORE, AFTER, CLIP = 3, 2, 300  # context: turns before and after the evidence turn, each clipped to CLIP characters

SYSTEM = "You check one entry proposed for a meeting's decision ledger against the meeting transcript."
QUESTION = "In this excerpt, is {value} for {item} firmly decided or committed, not proposed, discussed or hypothetical?"
RULES = (
    "YES only if the speakers settle it here: they decide, agree, confirm or commit to {value} for {item}.\n"
    "NO if {value} is only suggested, proposed, preferred, asked about, discussed, hoped for, hypothetical or reported as "
    "someone's idea, or if the excerpt is not about {value} for {item}.\n"
    "Examples from another meeting series (entry: Caterer = Firm P):\n"
    '"Fine, we go with Firm P." -> YES\n'
    '"So Firm P it is then. Okay." -> YES\n'
    '"Should we ask Firm P for a quote?" -> NO\n'
    '"I think Firm P would be nice." -> NO\n'
    '"Firm P delivered the lunch late." -> NO\n'
)
WORDINGS = {"w1": QUESTION, "w2": RULES + QUESTION}
TEMPLATE = "EXCERPT (the line marked >> holds the quote):\n{excerpt}\n\nQUOTE: \"{quote}\"\nENTRY: {item} ({attribute}) = {value}\n\n{ask}\nReply with one word: YES or NO."


def prompt_sha(wording, variant):
    parts = [SYSTEM, WORDINGS[wording], TEMPLATE, variant] + ([str((BEFORE, AFTER, CLIP))] if variant == "context" else [])
    return hashlib.sha256("\x1e".join(parts).encode()).hexdigest()


def _clip(text):
    return text if len(text) <= CLIP else text[:CLIP].rsplit(" ", 1)[0] + " ..."


def excerpt(meeting, registry, d, variant):
    turns = meeting.turns
    who = lambda t: registry.people.get(t.speaker, t.speaker)
    quote = meeting.text[d.span[0]:d.span[1]]
    if variant == "quote":
        return f">> {who(turns[d.turn])}: {quote}"
    lines = []
    for t in turns[max(0, d.turn - BEFORE): d.turn + AFTER + 1]:
        mark, text = (">> ", t.text) if t.index == turns[d.turn].index else ("", _clip(t.text))
        lines.append(f"{mark}{who(t)}: {text}")
    return "\n".join(lines)


def messages(meeting, registry, d, wording, variant):
    """The question about one disposition `d` that the pipeline would write (grounded turn, span, slot, value)."""
    item = registry.objects[d.object_id].label
    fill = {"item": item, "value": d.value, "attribute": d.attribute}
    user = TEMPLATE.format(excerpt=excerpt(meeting, registry, d, variant), quote=meeting.text[d.span[0]:d.span[1]],
                           ask=WORDINGS[wording].format(**fill), **fill)
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]


def _live_scorer():
    socket_path = os.environ.get("MEMORIA_QWEN_SOCKET", "")
    if not socket_path or not Path(socket_path).exists():
        raise SystemExit("MEMORIA_QWEN_SOCKET must name the running app's Qwen socket (no model is ever started here)")
    spec = importlib.util.spec_from_file_location("qwen_scoring", SCORING)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.first_token_logprobs


class Scores:
    """Cached first-token log-odds. live=False: a cache miss stops the run."""

    def __init__(self, path, live=False):
        self.path, self.live, self.calls = Path(path), live, 0
        self.cache = {}
        if self.path.exists():
            for line in self.path.read_text().splitlines():
                if line.strip():
                    record = json.loads(line)
                    self.cache[record["key"]] = record
        self._ask = _live_scorer() if live else None

    def __call__(self, msgs, meta):
        key = hashlib.sha256(json.dumps(msgs, sort_keys=True).encode()).hexdigest()
        if key not in self.cache:
            if not self.live:
                raise SystemExit(f"gate score not cached ({meta}); rerun with live scoring")
            started = time.perf_counter()
            logprobs = self._ask(msgs)
            record = {"key": key, **meta, "yes": logprobs["YES"], "no": logprobs["NO"], "score": logprobs["YES"] - logprobs["NO"],
                      "seconds": round(time.perf_counter() - started, 4), "model": MODEL, "recorded": time.strftime("%Y-%m-%d %H:%M:%S")}
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a") as fh:
                fh.write(json.dumps(record) + "\n")
            self.cache[key] = record
            self.calls += 1
        return self.cache[key]


class Gate:
    """keep(meeting, registry, d) for replay.Replayed: True when the event's score reaches tau."""

    def __init__(self, scores, wording, variant, tau):
        self.scores, self.wording, self.variant, self.tau = scores, wording, variant, tau

    def record(self, meeting, registry, d):
        meta = {"meeting": meeting.meeting_id, "turn": d.turn, "object": d.object_id, "attribute": d.attribute, "value": d.value,
                "wording": self.wording, "variant": self.variant, "prompt_sha": prompt_sha(self.wording, self.variant)}
        return self.scores(messages(meeting, registry, d, self.wording, self.variant), meta)

    def __call__(self, meeting, registry, d):
        return self.record(meeting, registry, d)["score"] >= self.tau
