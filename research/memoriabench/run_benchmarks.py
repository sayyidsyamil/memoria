"""The master benchmark runner: five systems on the same MemoriaBench probes, one model at a time.

    B0  closed book: Qwen3.5 with no memory at all (is the benchmark solvable from the wording alone?)
    B1  embeddings only: a probe raises an alert when its cosine similarity to a memory item reaches a threshold;
        B1b is the same similarities cut into three bands (a stronger version of the same idea)
    B2  standard transcript RAG: the raw words of meetings a-c, cut into chunks, the five nearest read by Qwen3.5
    M2  Full Memoria: memoria.check_statement on the versioned decisions.md that memory_for() builds
    A1  an ablation of M2: the same decisions with nothing replaced and no "(replaces ...)" notes

Fairness rules, all enforced here and checked in test_benchmarks.py:
  - A system is handed a series id and a statement. Never a gold label, a gold citation, an id or a provenance field.
  - Nothing is tuned on the test set. The embedding thresholds are chosen on the development series (the same recipe
    as the benchmark, run on ES2003, ES2011, IS1008, TS3004, TS3006); every prompt is written before the test run.
  - The benchmark must still match its freeze (data/memoria_bench.sha256) or the run is refused.
  - Each system runs in its own process, so that its peak memory is its own and a crash costs one system.
  - Only one model process at a time: two together crash this 16 GB Mac. The run refuses to start while another
    process (Memoria.app, the MCP server) holds more than 1 GB of model memory.

Run: python3.11 run_benchmarks.py [--systems B0,B1,B2,M2,A1] [--split test|dev] [--limit N] [--fresh]
"""

import argparse
import ctypes
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

import eval_metrics as E

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
RESULTS = HERE / "results"
CACHE = RESULTS / "cache"
THRESHOLDS = RESULTS / "b1_thresholds.json"
BENCH_FILE, PROVENANCE_FILE, HASH_FILE = DATA / "memoria_bench.jsonl", DATA / "memoria_bench.provenance.jsonl", DATA / "memoria_bench.sha256"
DEV_FILE, DEV_PROVENANCE_FILE = DATA / "memoria_bench_dev.jsonl", DATA / "memoria_bench_dev.provenance.jsonl"

EMBEDDER = "BAAI/bge-small-en-v1.5"  # 33M parameters, 384 dimensions; run on the CPU, so it never competes with Qwen for Metal memory
CHUNK_WORDS, CHUNK_OVERLAP, TOP_K = 90, 25, 5  # B2: chosen before any run, and not changed after seeing a result
MIN_WORDS = 3  # B2 drops one- and two-word backchannel ("mm-hmm", "yeah") before chunking
MODEL_MEMORY_LIMIT_GB = 1.0
ORDER = ("B0", "B1", "B2", "M2", "A1")
NO_MEMORY = "(no approved decisions are available)"
LABEL_PATTERN = None  # set from memoria.LABELS once memoria is imported


# --- what a system may see ------------------------------------------------------------------------------

RAG_CLASS_GUIDE = (
    "Classes, in order:\n"
    "1. IRRELEVANT: social chatter or logistics unrelated to the project (food, weather, sport, greetings), "
    "even when phrased as a suggestion.\n"
    "2. OUTDATED: still uses an old option that the excerpts show the team later replaced.\n"
    "3. CONTRADICTS: conflicts with what the team settled in the excerpts (a different value, material or market; "
    "a figure above a cap or budget; a different date, quarter or deadline, earlier or later).\n"
    "4. SUPPORTED_CURRENT: consistent with what the team settled in the excerpts (reaffirms it, or stays within its cap).\n"
    "5. UPDATES: suggests adding or changing something that the excerpts do not settle.\n"
    "6. INSUFFICIENT_EVIDENCE: any other claim about the project (progress, results, events) "
    "that the excerpts cannot confirm or refute.\n"
    "For OUTDATED or CONTRADICTS reply exactly: CLASS | reason in under 12 words\n"
    "For every other class reply with the class name only.\n"
    "Examples, using the excerpts of another team: [QQ1a 02:00] PM: Let's stop buying from Globex, Acme is cheaper. "
    "[QQ1a 03:00] PM: The budget is fifty thousand, no more. [QQ1b 01:00] PM: We launch in March.\n"
    '"We\'ll keep ordering from Globex." -> OUTDATED | The team replaced Globex with Acme\n'
    '"The budget will reach sixty-five thousand." -> CONTRADICTS | Exceeds the fifty thousand budget\n'
    '"The release will go out in June." -> CONTRADICTS | The team settled on a March launch\n'
    '"Acme is confirmed for the contract." -> SUPPORTED_CURRENT\n'
    '"Let\'s add a dark mode." -> UPDATES\n'
    '"Did anyone watch the match?" -> IRRELEVANT\n'
    '"The client loved the demo." -> INSUFFICIENT_EVIDENCE'
)


def rag_messages(excerpts: list[str], statement: str) -> list[dict]:
    from memoria import SYSTEM_PROMPT  # the auditor's own system prompt, so only the memory differs

    body = "\n".join(excerpts)
    return [{"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"EXCERPTS FROM EARLIER MEETINGS (the most relevant first; each is tagged with its meeting and time):\n{body}\n\n"
                                        f"{RAG_CLASS_GUIDE}\n\nLIVE STATEMENT:\n{statement}"}]


def chunk_utterances(utterances: list[dict], target_words: int = CHUNK_WORDS, overlap_words: int = CHUNK_OVERLAP) -> list[dict]:
    """Consecutive utterances grouped to about target_words each. A window starts at the utterance where the last
    overlap_words of the previous one begin, so that a sentence cut by one window is whole in the next."""
    counts = [len(u["text"].split()) for u in utterances]
    chunks, start = [], 0
    while start < len(utterances):
        end, words = start, 0
        while end < len(utterances) and words < target_words:
            words += counts[end]
            end += 1
        taken = utterances[start:end]
        minutes, seconds = divmod(int(taken[0]["start"]), 60)
        chunks.append({"id": f"{taken[0]['meeting']}@{minutes:02d}:{seconds:02d}", "meeting": taken[0]["meeting"], "start": taken[0]["start"],
                       "text": f"[{taken[0]['meeting']} {minutes:02d}:{seconds:02d}] " + " ".join(f"{u['role'] or u['speaker']}: {u['text']}" for u in taken)})
        if end >= len(utterances):
            break
        back, kept = end, 0
        while back - 1 > start and kept + counts[back - 1] <= overlap_words:
            back -= 1
            kept += counts[back]
        if end - 1 > start:
            back = min(back, end - 1)  # an utterance longer than the overlap is still repeated, so that every boundary is shared
        start = max(back, start + 1)
    return chunks


def memory_items(versioned: str) -> list[dict]:
    """The lines an auditor reads, as items B1 compares a statement with: the decision and its note, without the citation."""
    items = []
    for line in versioned.splitlines():
        match = re.match(r"- \[([^\]]+)\] (.+)", line)
        if match:
            items.append({"citation": f"[{match.group(1)}]", "text": match.group(2)})
    return items


# --- measuring ---------------------------------------------------------------------------------------------

def footprint_gb(pid: int | None = None) -> tuple[float, float] | None:
    """(now, lifetime maximum) physical footprint of a process in GB, which counts Metal buffers; RSS would not."""
    info = (ctypes.c_uint64 * 50)()
    if ctypes.CDLL("/usr/lib/libproc.dylib").proc_pid_rusage(pid or os.getpid(), 4, ctypes.byref(info)) != 0:
        return None
    return info[2 + 7] / 1e9, info[2 + 28] / 1e9


def busy_model_processes(listing: str | None = None, own: int | None = None, measure=footprint_gb) -> list[tuple[int, str, float]]:
    """Processes of ours that hold a model: (pid, what, GB). Two MLX models at once crash this Mac."""
    listing = subprocess.run(["ps", "-axo", "pid=,command="], capture_output=True, text=True).stdout if listing is None else listing
    found = []
    for line in listing.splitlines():
        pid_text, _, command = line.strip().partition(" ")
        if not pid_text.isdigit() or int(pid_text) == (own or os.getpid()):
            continue
        if re.search(r"memoria/(?:hud|mcp_server)\.py|run_benchmarks\.py --worker|mlx_lm", command):
            gb = (measure(int(pid_text)) or (0.0, 0.0))[0]
            if gb >= MODEL_MEMORY_LIMIT_GB:
                found.append((int(pid_text), command.split("/")[-1][:60], gb))
    return found


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_freeze() -> str | None:
    """None if the benchmark and its provenance still match data/memoria_bench.sha256, otherwise what is wrong."""
    if not HASH_FILE.exists():
        return f"{HASH_FILE.name} does not exist: run validate_bench.py first, so the benchmark is frozen"
    frozen = {line.split()[1]: line.split()[0] for line in HASH_FILE.read_text().splitlines() if line.strip()}
    moved = [p.name for p in (BENCH_FILE, PROVENANCE_FILE) if frozen.get(p.name) != sha256(p)]
    return f"{', '.join(moved)} no longer match {HASH_FILE.name}: the frozen benchmark was changed" if moved else None


def read_lines(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def files_for(split: str) -> tuple[Path, Path]:
    return (BENCH_FILE, PROVENANCE_FILE) if split == "test" else (DEV_FILE, DEV_PROVENANCE_FILE)


def work_folder(split: str) -> Path:
    return RESULTS / ("_work" if split == "test" else "dev" / Path("_work"))


# --- the embedder ------------------------------------------------------------------------------------------

class Embedder:
    def __init__(self) -> None:
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        import torch
        from transformers import AutoModel, AutoTokenizer

        self.torch = torch
        self.tokenizer = AutoTokenizer.from_pretrained(EMBEDDER)
        self.model = AutoModel.from_pretrained(EMBEDDER).eval()

    def encode(self, texts: list[str], batch: int = 64) -> np.ndarray:
        out = []
        with self.torch.no_grad():
            for i in range(0, len(texts), batch):
                encoded = self.tokenizer(texts[i:i + batch], padding=True, truncation=True, max_length=256, return_tensors="pt")
                vectors = self.model(**encoded).last_hidden_state[:, 0]  # bge pools with the first token
                out.append(self.torch.nn.functional.normalize(vectors, dim=-1).numpy())
        return np.concatenate(out).astype("float32") if out else np.zeros((0, 384), dtype="float32")


# --- the cache: everything read from the corpus, once --------------------------------------------------------

def build_cache(split: str) -> dict:
    """Per series: the versioned and unversioned decisions.md, the memory items, the transcript chunks and their
    embeddings. Read from the AMI corpus once (a few minutes) and reused by every system."""
    import generate_bench as G
    from ami_loader import Series

    rows_file, provenance_file = files_for(split)
    meta_path, vectors_path = CACHE / f"{split}.json", CACHE / f"{split}_chunks.npz"
    stamp = {"rows": sha256(rows_file), "provenance": sha256(provenance_file), "chunking": [CHUNK_WORDS, CHUNK_OVERLAP, MIN_WORDS], "embedder": EMBEDDER}
    if meta_path.exists() and vectors_path.exists():
        cached = json.loads(meta_path.read_text(encoding="utf-8"))
        if cached["stamp"] == stamp:
            return cached
    rows, provenance = read_lines(rows_file), read_lines(provenance_file)
    folder = CACHE / "memory" / split
    folder.mkdir(parents=True, exist_ok=True)
    embedder = Embedder()
    cache, vectors = {"stamp": stamp, "series": {}}, {}
    names = sorted({r["series_id"] for r in rows})
    for number, name in enumerate(names, 1):
        began = time.monotonic()
        series = Series(name, history_only=True)
        decisions = list(series.decisions)
        versioned = G.memory_for(name, decisions, rows, provenance)
        unversioned = "".join(f"- [{d.citation}] {d.text}\n" for d in decisions)
        (folder / f"{name}.versioned.md").write_text(versioned, encoding="utf-8")
        (folder / f"{name}.unversioned.md").write_text(unversioned, encoding="utf-8")
        chunks = []
        for letter in "abc":
            chunks += chunk_utterances(series.transcript(letter, min_words=MIN_WORDS))
        vectors[name] = embedder.encode([c["text"] for c in chunks])
        cache["series"][name] = {"versioned_file": str(folder / f"{name}.versioned.md"), "unversioned_file": str(folder / f"{name}.unversioned.md"),
                                 "items": memory_items(versioned), "chunks": [{"id": c["id"], "text": c["text"]} for c in chunks]}
        print(f"  cache {split} {number}/{len(names)} {name}: {len(decisions)} decisions, {len(chunks)} chunks ({time.monotonic() - began:.0f}s)", file=sys.stderr, flush=True)
    np.savez_compressed(vectors_path, **vectors)
    meta_path.write_text(json.dumps(cache), encoding="utf-8")
    return cache


# --- the systems ---------------------------------------------------------------------------------------------

def label_of(raw: str) -> tuple[bool, str]:
    """(was the reply readable, its label), the way memoria._parse reads it, so that unreadable replies can be counted."""
    from memoria import LABELS

    label_part = raw.split("|", 1)[0]
    match = re.search("|".join(LABELS), re.sub(r"[\s-]+", "_", label_part.upper()))
    return bool(match), (match.group() if match else "INSUFFICIENT_EVIDENCE")


class ClosedBook:
    id = "B0"

    def __init__(self, cache: dict, split: str) -> None:
        import memoria

        self.memoria = memoria
        self.model, self.tokenizer = memoria.load_model()

    def predict(self, series: str, statement: str) -> list[dict]:
        raw = self.memoria.audit(self.model, self.tokenizer, NO_MEMORY, statement)
        ok, label = label_of(raw)
        return [{"system": self.id, "pred": label, "alert": label in E.ALERTS, "citation": "", "raw": raw, "readable": ok}]


class FullMemoria:
    """M2 is memoria.check_statement itself, unchanged; A1 is the same call on decisions that were never versioned."""

    def __init__(self, cache: dict, split: str, versioned: bool = True) -> None:
        import memoria

        self.id = "M2" if versioned else "A1"
        self.memoria, self.cache, self.versioned = memoria, cache, versioned
        self.last = {"raw": ""}
        original = memoria.audit

        def capture(model, tokenizer, decisions, statement):  # note the reply, then hand it on untouched
            self.last["raw"] = original(model, tokenizer, decisions, statement)
            return self.last["raw"]

        memoria.audit = capture
        memoria.load_model()

    def predict(self, series: str, statement: str) -> list[dict]:
        path = self.cache["series"][series]["versioned_file" if self.versioned else "unversioned_file"]
        result = self.memoria.check_statement(statement, decisions_file=path)
        ok, _ = label_of(self.last["raw"])
        return [{"system": self.id, "pred": result["label"], "alert": result["alert"], "citation": result["citation"], "raw": self.last["raw"], "readable": ok}]


class TranscriptRag:
    id = "B2"

    def __init__(self, cache: dict, split: str) -> None:
        import memoria

        self.memoria, self.cache = memoria, cache
        self.embedder = Embedder()
        vectors = np.load(CACHE / f"{split}_chunks.npz")
        self.vectors = {name: vectors[name] for name in vectors.files}
        self.model, self.tokenizer = memoria.load_model()

    def predict(self, series: str, statement: str) -> list[dict]:
        from mlx_lm import generate
        from mlx_lm.sample_utils import make_sampler

        query = self.embedder.encode([statement])[0]
        best = np.argsort(-(self.vectors[series] @ query))[:TOP_K]
        chunks = self.cache["series"][series]["chunks"]
        messages = rag_messages([chunks[i]["text"] for i in best], statement)
        prompt = self.tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        raw = generate(self.model, self.tokenizer, prompt=prompt, max_tokens=self.memoria.MAX_TOKENS, sampler=make_sampler(temp=self.memoria.TEMPERATURE),
                       prefill_step_size=self.memoria.PREFILL_STEP).strip()
        ok, label = label_of(raw)
        return [{"system": self.id, "pred": label, "alert": label in E.ALERTS, "citation": "", "raw": raw, "readable": ok,
                 "retrieved": [chunks[i]["id"] for i in best]}]


class EmbeddingOnly:
    id = "B1"

    def __init__(self, cache: dict, split: str) -> None:
        self.embedder = Embedder()
        self.items = {name: data["items"] for name, data in cache["series"].items()}
        self.vectors = {name: self.embedder.encode([i["text"] for i in items]) for name, items in self.items.items()}
        self.limits = json.loads(THRESHOLDS.read_text(encoding="utf-8")) if THRESHOLDS.exists() else None

    def predict(self, series: str, statement: str) -> list[dict]:
        sims = self.vectors[series] @ self.embedder.encode([statement])[0]
        best = int(np.argmax(sims))
        sim, cited = float(sims[best]), self.items[series][best]["citation"]
        out = []
        for system, label in (("B1", None), ("B1b", None)):
            if self.limits is None:  # the development run that has to come first: the similarities are all it needs
                pred, alert = "", False
            elif system == "B1":
                alert = sim >= self.limits["tau_alert"]
                pred = "CONTRADICTS" if alert else "IRRELEVANT"  # the one thing it can say: "related to a decision" or not
            else:
                pred = E.band_label(sim, self.limits["low"], self.limits["high"])
                alert = pred in E.ALERTS
            out.append({"system": system, "pred": pred, "alert": alert, "citation": cited if alert else "", "sim": round(sim, 5), "readable": True, "raw": ""})
        return out


def make_system(name: str, cache: dict, split: str):
    return {"B0": lambda: ClosedBook(cache, split), "B1": lambda: EmbeddingOnly(cache, split), "B2": lambda: TranscriptRag(cache, split),
            "M2": lambda: FullMemoria(cache, split, True), "A1": lambda: FullMemoria(cache, split, False)}[name]()


# --- the worker: one system, one process --------------------------------------------------------------------------

def pick_probes(rows: list[dict], limit: int | None) -> list[dict]:
    return rows if not limit or limit >= len(rows) else [rows[i * len(rows) // limit] for i in range(limit)]


def worker(system_name: str, split: str, limit: int | None) -> int:
    began = time.monotonic()
    cache = json.loads((CACHE / f"{split}.json").read_text(encoding="utf-8"))
    rows_file, _ = files_for(split)
    probes = pick_probes(read_lines(rows_file), limit)
    system = make_system(system_name, cache, split)
    loaded = time.monotonic() - began
    first = probes[0]
    system.predict(first["series_id"], "Let us get started, everyone.")  # warm-up: weights paged in, kernels compiled, never timed
    folder = work_folder(split)
    folder.mkdir(parents=True, exist_ok=True)
    outputs = ("B1", "B1b") if system_name == "B1" else (system_name,)
    done = {name: {r["id"] for r in read_lines(folder / f"{name}.jsonl")} if (folder / f"{name}.jsonl").exists() else set() for name in outputs}  # a run that stopped resumes
    handles = {name: (folder / f"{name}.jsonl").open("a", encoding="utf-8") for name in outputs}
    skipped = 0
    for number, probe in enumerate(probes, 1):
        if all(probe["id"] in done[name] for name in outputs):
            skipped += 1
            continue
        started = time.perf_counter()
        results = system.predict(probe["series_id"], probe["statement"])  # no gold label, citation or id goes in
        milliseconds = (time.perf_counter() - started) * 1000
        for result in results:
            record = {"id": probe["id"], "series_id": probe["series_id"], "statement": probe["statement"], "gold_label": probe["gold_label"],
                      "gold_citation": probe["gold_citation"], "expected_alert": probe["expected_alert"], **result, "latency_ms": round(milliseconds, 2)}
            handles[result["system"]].write(json.dumps(record, ensure_ascii=False) + "\n")
            handles[result["system"]].flush()
        if number % 25 == 0 or number == len(probes):
            print(f"  {system_name} {number}/{len(probes)} ({(time.monotonic() - began) / 60:.1f} min)", flush=True)
    peak = (footprint_gb() or (0.0, 0.0))[1]
    meta = {"split": split, "probes": len(probes), "peak_gb": round(peak, 3), "load_s": round(loaded, 1), "wall_s": round(time.monotonic() - began, 1), "embedder": EMBEDDER, "skipped_already_done": skipped}
    try:
        import memoria
        meta["model"] = memoria.MODEL
    except Exception:
        pass
    for system_id in outputs:
        (folder / f"{system_id}.meta.json").write_text(json.dumps({**meta, "system": system_id}), encoding="utf-8")
    return 0


# --- the parent --------------------------------------------------------------------------------------------------

def run_worker(system: str, split: str, limit: int | None) -> bool:
    command = [sys.executable, str(Path(__file__).resolve()), "--worker", system, "--split", split]
    if limit:
        command += ["--limit", str(limit)]
    environment = {**os.environ, "HF_HUB_OFFLINE": "1", "PYTHONUNBUFFERED": "1", "TOKENIZERS_PARALLELISM": "false"}
    return subprocess.run(command, env=environment).returncode == 0


def write_run_meta(path: Path | None = None) -> dict:
    """Everything a reader needs to reproduce or doubt a run: the machine, the software, the frozen benchmark's hashes,
    B1's thresholds and what each system's worker measured. Written beside the results."""
    def version(module: str) -> str:
        try:
            return __import__(module).__version__
        except Exception:
            return "n/a"

    def command(*args: str) -> str:
        return subprocess.run(args, capture_output=True, text=True).stdout.strip()

    meta = E.load_meta(work_folder("test"))
    record = {
        "machine": {"chip": command("sysctl", "-n", "machdep.cpu.brand_string"), "memory_gb": round(int(command("sysctl", "-n", "hw.memsize") or 0) / 1e9, 1), "macos": command("sw_vers", "-productVersion")},
        "software": {"python": sys.version.split()[0], "mlx": version("mlx"), "mlx_lm": version("mlx_lm"), "torch": version("torch"), "transformers": version("transformers"), "numpy": version("numpy")},
        "models": {"language_model": (next(iter(meta.values()), {}) or {}).get("model"), "embedder": EMBEDDER},
        "benchmark": {"file": BENCH_FILE.name, "sha256": sha256(BENCH_FILE), "provenance_sha256": sha256(PROVENANCE_FILE), "frozen": verify_freeze() is None},
        "settings": {"temperature": 0.0, "max_tokens": 60, "chunk_words": CHUNK_WORDS, "chunk_overlap_words": CHUNK_OVERLAP, "top_k": TOP_K, "backchannel_min_words": MIN_WORDS, "bootstrap_draws": E.BOOTSTRAPS, "seed": E.SEED},
        "b1_thresholds": json.loads(THRESHOLDS.read_text(encoding="utf-8")) if THRESHOLDS.exists() else None,
        "workers": {name: {k: v for k, v in m.items() if k in ("probes", "peak_gb", "load_s", "wall_s")} for name, m in meta.items()},
        "finished": time.strftime("%Y-%m-%d %H:%M:%S %z"),
    }
    (path or RESULTS / "run_meta.json").write_text(json.dumps(record, indent=1), encoding="utf-8")
    return record


def tune_thresholds() -> dict:
    """From the development run of B1: the similarity threshold for alerts, and the two for the three bands."""
    rows = read_lines(work_folder("dev") / "B1.jsonl")
    sims, gold = [r["sim"] for r in rows], [r["gold_label"] for r in rows]
    low, high = E.tune_bands(sims, gold)
    limits = {"tau_alert": E.tune_alert_threshold(sims, [r["expected_alert"] for r in rows]), "low": low, "high": high, "tuned_on": "development series", "probes": len(rows)}
    THRESHOLDS.write_text(json.dumps(limits, indent=1), encoding="utf-8")
    return limits


def merge(split: str, systems: list[str]) -> tuple[list[dict], dict[str, dict]]:
    folder = work_folder(split)
    predictions, meta = [], E.load_meta(folder)
    for system in [s for s in E.SYSTEMS if (s in systems or (s == "B1b" and "B1" in systems))]:
        path = folder / f"{system}.jsonl"
        if path.exists():
            predictions += [r for r in read_lines(path) if r["pred"]]  # B1's first development run has no thresholds yet and predicts nothing
    if "B1" in meta and "B1b" not in meta:
        meta["B1b"] = meta["B1"]
    return predictions, meta


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Run the five systems on MemoriaBench and print Table 6.1")
    parser.add_argument("--systems", default=",".join(ORDER), help="comma list of B0,B1,B2,M2,A1 (B1b rides along with B1)")
    parser.add_argument("--split", choices=("test", "dev"), default="test")
    parser.add_argument("--limit", type=int, help="run an evenly spaced sample of this many probes (a smoke test)")
    parser.add_argument("--fresh", action="store_true", help="delete earlier predictions for these systems first")
    parser.add_argument("--retune", action="store_true", help="choose B1's thresholds again from a development run")
    parser.add_argument("--table-only", action="store_true", help="do not run anything: rebuild the table from the predictions on disk")
    parser.add_argument("--worker", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.worker:
        return worker(args.worker, args.split, args.limit)
    systems = [s.strip() for s in args.systems.split(",") if s.strip()]
    unknown = [s for s in systems if s not in ORDER]
    if unknown:
        print(f"unknown system(s): {unknown}", file=sys.stderr)
        return 2
    folder = work_folder(args.split)
    rows_file, provenance_file = files_for(args.split)
    if args.split == "test" and (broken := verify_freeze()):
        print(f"refused: {broken}", file=sys.stderr)
        return 1
    if not args.table_only:
        busy = busy_model_processes() if any(s != "B1" for s in systems) else []  # only B1 runs without a language model
        if busy:
            for pid, what, gb in busy:
                print(f"refused: process {pid} ({what}) holds {gb:.1f} GB of model memory. Two MLX models at once crash this Mac: quit it first.", file=sys.stderr)
            return 1
        subprocess.Popen(["caffeinate", "-i", "-w", str(os.getpid())])  # the Mac must not doze off mid-run
        print("[Preparing] reading the corpus once for the memories, the chunks and their embeddings...", file=sys.stderr, flush=True)
        build_cache(args.split)
        if args.split == "test" and "B1" in systems and (args.retune or not THRESHOLDS.exists()):
            print("[Tuning] B1's thresholds on the development series first", file=sys.stderr, flush=True)
            build_cache("dev")
            (work_folder("dev") / "B1.jsonl").unlink(missing_ok=True)
            if not run_worker("B1", "dev", None):
                return 1
            print(f"  thresholds: {tune_thresholds()}", file=sys.stderr)
        n = len(read_lines(rows_file))
        print(f"[Benchmarking MemoriaBench] (N={n} across {len({r['series_id'] for r in read_lines(rows_file)})} series)" + (f", a sample of {args.limit}" if args.limit else ""))
        for position, system in enumerate(systems):
            if args.fresh:
                for name in (system, "B1b") if system == "B1" else (system,):
                    for suffix in (".jsonl", ".meta.json"):
                        (folder / f"{name}{suffix}").unlink(missing_ok=True)
            lead = "└──" if position == len(systems) - 1 else "├──"
            print(f"  {lead} Running {system} ({E.SYSTEMS[system].split(': ', 1)[1]})...", flush=True)
            began = time.monotonic()
            if not run_worker(system, args.split, args.limit):
                print(f"{system} failed", file=sys.stderr)
                return 1
            print(f"  {'   ' if lead == '└──' else '│  '}   done in {(time.monotonic() - began) / 60:.1f} min", flush=True)
            if args.split == "dev" and system == "B1":
                print(f"  thresholds tuned on the development series: {tune_thresholds()}", flush=True)
    predictions, meta = merge(args.split, systems)
    basis = {p["id"]: p["basis"] for p in read_lines(provenance_file) if p.get("basis")}
    if args.split == "test":
        RESULTS.mkdir(exist_ok=True)
        (RESULTS / "predictions_raw.jsonl").write_text("".join(json.dumps(p, ensure_ascii=False) + "\n" for p in predictions), encoding="utf-8")
        print("\n" + E.report(predictions, meta, basis, RESULTS / "table_6_1.csv", RESULTS / "per_class.csv"))
        write_run_meta()
        print("Results exported to results/table_6_1.csv, results/per_class.csv, results/predictions_raw.jsonl and results/run_meta.json.")
    else:
        print("\n[Development set: 5 series, 60 probes. For tuning and for checking the plumbing; not a result.]\n" + E.report(predictions, meta, basis))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
