"""Runner for the topic-scoping experiment (the question, conditions and endpoints are in scoping.py).

    python3.11 run_scoping.py prepare               write the C1 and C2 memories for the test series, no model
    python3.11 run_scoping.py tune                  choose k on the development series from scope recall, no model
    python3.11 run_scoping.py freeze                pin the code, the config and the benchmark before the test run
    python3.11 run_scoping.py run [--split test|dev] [--systems M3@C0,M2@C0,...] [--limit N] [--smoke]
    python3.11 run_scoping.py topic-latency         E6: one LLM call that names a topic, timed
    python3.11 scoping_report.py                    the analysis (separate file, so that fixing it does not unfreeze the run)

Rules, as in run_benchmarks.py: a system is handed a series id and a statement and nothing else; one model process at a
time (two together crash this 16 GB Mac, so the run refuses to start while Memoria.app holds a model); each system and
condition runs in its own process; a stopped run resumes; the frozen benchmark must be unchanged; and a test run is
refused unless the pre-registration matches the code on disk.
"""

import argparse
import glob
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
import run_benchmarks as R
import scoping as S

HERE = Path(__file__).resolve().parent
OUT = HERE / "results" / "scoping"
MEMORY = OUT / "memory"
CONFIG = OUT / "config.json"
PREREG = OUT / "preregistration.json"
CONDITIONS = tuple(S.CONDITIONS)
SYSTEMS = ("M3@C0", "M2@C0", "M3@C1", "M2@C1", "M3@C2", "M2@C2")  # the cheap ones first
PINNED = ("scoping.py", "run_scoping.py")
TOPIC_PROMPT = ("Name the topic of this meeting statement in one or two words, for example Battery, Budget, Case material or Schedule. "
                "Reply with the topic only.\nSTATEMENT: {statement}\nTOPIC:")
TOPIC_PROBES = 30


# --- the data ----------------------------------------------------------------------------------------------------

def load_split(split: str) -> tuple[dict[str, list[dict]], dict[str, list[str]], list[dict]]:
    """(each series' own decisions, each series' statements, the probes) of a split, read from the benchmark's cache."""
    memories = {Path(f).name.split(".")[0]: S.parse_memory(Path(f).read_text(encoding="utf-8")) for f in sorted(glob.glob(str(R.CACHE / "memory" / split / "*.versioned.md")))}
    rows_file, _ = R.files_for(split)
    probes = R.read_lines(rows_file)
    statements: dict[str, list[str]] = {}
    for probe in probes:
        statements.setdefault(probe["series_id"], []).append(probe["statement"])
    if not memories or set(memories) != set(statements):
        raise SystemExit(f"the cache for the {split} split is missing or does not match the benchmark: run run_benchmarks.py first")
    return memories, statements, probes


def memory_path(condition: str, series: str, split: str = "test") -> Path:
    return R.CACHE / "memory" / split / f"{series}.versioned.md" if condition == "C0" else MEMORY / condition / f"{series}.md"


def condition_memories(condition: str, split: str) -> dict[str, list[dict]]:
    return {Path(f).stem.split(".")[0]: S.parse_memory(Path(f).read_text(encoding="utf-8"))
            for f in sorted(glob.glob(str(memory_path(condition, "*", split))))}


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# --- no model: the memories, k, the freeze -----------------------------------------------------------------------

def prepare() -> dict:
    """Write the C1 and C2 memories of every test series, and what went into them."""
    memories, statements, _ = load_split("test")
    generic = S.generic_stems([i["text"] for items in memories.values() for i in items])
    record = {"generic_stems": sorted(generic), "seed": S.SEED, "conditions": {c: S.CONDITIONS[c] for c in CONDITIONS}, "series": {}}
    for condition in ("C1", "C2"):
        (MEMORY / condition).mkdir(parents=True, exist_ok=True)
    for series in sorted(memories):
        record["series"][series] = {"own": len(memories[series])}
        for condition in ("C1", "C2"):
            text, meta = S.build_memory(series, condition, memories, statements, generic)
            (MEMORY / condition / f"{series}.md").write_text(text, encoding="utf-8")
            record["series"][series][condition] = {"decisions": meta["own"] + meta["distractors"], "distractors": meta["distractors"], "pool": meta["pool"],
                                                   "distractor_ids": meta["distractor_ids"]}
    (OUT / "conditions.json").write_text(json.dumps(record, indent=1), encoding="utf-8")
    return record


def recall_sweep(embedder, memories: dict[str, list[dict]], probes: list[dict]) -> dict:
    """Scope recall for k = 1..8, with and without the money/time rule: {rule: {k: scope_recall(...)}}."""
    out = {}
    for rule in (False, True):
        out["rule" if rule else "no_rule"] = {}
        for k in S.K_GRID:
            scoper = S.Scoper(embedder, memories, k, rule=rule)
            rows = [{**p, "scope_ids": scoper.scope(p["series_id"], p["statement"])["ids"]} for p in probes]
            out["rule" if rule else "no_rule"][k] = S.scope_recall(rows) | {"mean_scope": float(np.mean([len(r["scope_ids"]) for r in rows]))}
    return out


def tune() -> dict:
    """k from the development series by the pre-registered rule; written to config.json."""
    memories, _, probes = load_split("dev")
    sweep = recall_sweep(R.Embedder(), memories, probes)
    k = S.tune_k({int(k): v["recall"] for k, v in sweep["rule"].items()})
    config = {"k": k, "extra": S.EXTRA, "rule": True, "embedder": R.EMBEDDER, "seed": S.SEED, "rule_for_k": f"smallest k in {list(S.K_CHOICES)} with development scope recall >= {S.K_RECALL_TARGET}",
              "development": {"series": sorted(memories), "probes": len(probes), "sweep": sweep}}
    OUT.mkdir(parents=True, exist_ok=True)
    CONFIG.write_text(json.dumps(config, indent=1), encoding="utf-8")
    return config


def freeze() -> dict:
    """Pin everything the test run depends on, before it starts."""
    if not CONFIG.exists():
        raise SystemExit("run tune first: k is chosen on the development series")
    record = {"written": time.strftime("%Y-%m-%d %H:%M:%S %z"), "files": {name: sha256_of(HERE / name) for name in PINNED},
              "config": sha256_of(CONFIG), "benchmark": sha256_of(R.BENCH_FILE), "memoria_py": sha256_of(HERE / "memoria.py"),
              "conditions": sha256_of(OUT / "conditions.json"), "k": json.loads(CONFIG.read_text())["k"]}
    PREREG.write_text(json.dumps(record, indent=1), encoding="utf-8")
    return record


def prereg_problem() -> str | None:
    """None if the pre-registration exists and still matches the code, the config and the benchmark; otherwise what is wrong."""
    if not PREREG.exists():
        return "no pre-registration: run freeze before a test run"
    pinned = json.loads(PREREG.read_text())
    now = {"config": CONFIG, "benchmark": R.BENCH_FILE, "memoria_py": HERE / "memoria.py", "conditions": OUT / "conditions.json"}
    moved = [name for name, path in now.items() if not path.exists() or pinned.get(name) != sha256_of(path)]
    moved += [name for name in PINNED if pinned["files"].get(name) != sha256_of(HERE / name)]
    return f"changed since the pre-registration: {', '.join(moved)}" if moved else None


# --- the guard ---------------------------------------------------------------------------------------------------

def busy_model_processes(listing: str | None = None, own: int | None = None, measure=R.footprint_gb) -> list[tuple[int, str, float]]:
    """Processes of ours that hold a model: (pid, what, GB). Two MLX models at once crash this Mac."""
    listing = subprocess.run(["ps", "-axo", "pid=,command="], capture_output=True, text=True).stdout if listing is None else listing
    found = []
    for line in listing.splitlines():
        pid_text, _, command = line.strip().partition(" ")
        if not pid_text.isdigit() or int(pid_text) == (own or os.getpid()):
            continue
        if re.search(r"memoria/(?:hud|mcp_server)\.py|run_benchmarks\.py --worker|run_scoping\.py --worker|mlx_lm", command):
            gb = (measure(int(pid_text)) or (0.0, 0.0))[0]
            if gb >= R.MODEL_MEMORY_LIMIT_GB:
                found.append((int(pid_text), command.split("/")[-1][:60], gb))
    return found


# --- the systems -------------------------------------------------------------------------------------------------

class Spy:
    """Wraps memoria.generate to note the prompt and the raw reply of the last call, and hands everything on untouched."""

    def __init__(self, memoria) -> None:
        self.memoria, self.last = memoria, {"prompt": "", "raw": ""}
        original = memoria.generate

        def spy(model, tokenizer, prompt, **options):
            self.last["prompt"] = prompt
            self.last["raw"] = original(model, tokenizer, prompt=prompt, **options)
            return self.last["raw"]

        memoria.generate = spy


class Unscoped:
    """M2: memoria.check_statement, unchanged, on the memory file of the series in this condition."""

    def __init__(self, condition: str, split: str, memories: dict[str, list[dict]], config: dict) -> None:
        import memoria

        self.memoria, self.condition, self.split, self.spy = memoria, condition, split, Spy(memoria)
        self.ids = {series: [i["id"] for i in items] for series, items in memories.items()}
        memoria.load_model()

    def predict(self, series: str, statement: str) -> dict:
        result = self.memoria.check_statement(statement, decisions_file=str(memory_path(self.condition, series, self.split)))
        ok, _ = R.label_of(self.spy.last["raw"])
        return {"pred": result["label"], "alert": result["alert"], "citation": result["citation"], "raw": self.spy.last["raw"].strip(), "readable": ok,
                "scope_ids": self.ids[series], "cue": S.has_cue(statement), "added": 0}


class Scoped:
    """M3: the same auditor on the scope: the k most similar decisions, plus money/time limits when the statement mentions them."""

    def __init__(self, condition: str, split: str, memories: dict[str, list[dict]], config: dict) -> None:
        import memoria

        self.memoria, self.spy = memoria, Spy(memoria)
        self.scoper = S.Scoper(R.Embedder(), memories, config["k"], config["extra"], config["rule"])
        self.model, self.tokenizer = memoria.load_model()

    def predict(self, series: str, statement: str) -> dict:
        scope = self.scoper.scope(series, statement)
        raw = self.memoria.audit(self.model, self.tokenizer, scope["text"] or R.NO_MEMORY, statement)
        label, _, citation = self.memoria._parse(raw, scope["text"])
        ok, _ = R.label_of(raw)
        return {"pred": label, "alert": label in E.ALERTS, "citation": citation, "raw": raw, "readable": ok,
                "scope_ids": scope["ids"], "cue": scope["cue"], "added": scope["added"]}


def make_system(system: str, split: str, config: dict):
    kind, condition = system.split("@")
    memories = condition_memories(condition, split)
    return {"M2": Unscoped, "M3": Scoped}[kind](condition, split, memories, config), memories


# --- the worker --------------------------------------------------------------------------------------------------

def folder_for(split: str, smoke: bool) -> Path:
    return OUT / ("_smoke" if smoke else ("_work" if split == "test" else "_dev"))


def worker(system: str, split: str, limit: int | None, smoke: bool) -> int:
    began = time.monotonic()
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    rows_file, _ = R.files_for(split)
    probes = R.pick_probes(R.read_lines(rows_file), limit)
    runner, memories = make_system(system, split, config)
    loaded = time.monotonic() - began
    runner.predict(probes[0]["series_id"], "Let us get started, everyone.")  # warm-up: weights paged in, kernels compiled, never timed
    folder = folder_for(split, smoke)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{system}.jsonl"
    done = {r["id"] for r in R.read_lines(path)} if path.exists() else set()
    handle = path.open("a", encoding="utf-8")
    spy = runner.spy
    tokenizer = runner.tokenizer if hasattr(runner, "tokenizer") else runner.memoria.load_model()[1]
    for number, probe in enumerate(probes, 1):
        if probe["id"] in done:
            continue
        started = time.perf_counter()
        result = runner.predict(probe["series_id"], probe["statement"])  # no gold label, citation or id goes in
        milliseconds = (time.perf_counter() - started) * 1000
        tokens = len(tokenizer.encode(spy.last["prompt"]))
        record = {"id": probe["id"], "series_id": probe["series_id"], "statement": probe["statement"], "gold_label": probe["gold_label"], "gold_citation": probe["gold_citation"],
                  "expected_alert": probe["expected_alert"], "system": system, **result, "memory_lines": len(memories[probe["series_id"]]), "scope_size": len(result["scope_ids"]),
                  "prompt_tokens": tokens, "latency_ms": round(milliseconds, 2)}
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        handle.flush()
        if number % 25 == 0 or number == len(probes):
            print(f"  {system} {number}/{len(probes)} ({(time.monotonic() - began) / 60:.1f} min)", flush=True)
    peak = (R.footprint_gb() or (0.0, 0.0))[1]
    import memoria

    (folder / f"{system}.meta.json").write_text(json.dumps({"system": system, "split": split, "probes": len(probes), "peak_gb": round(peak, 3), "load_s": round(loaded, 1),
                                                          "wall_s": round(time.monotonic() - began, 1), "k": config["k"], "model": memoria.MODEL, "embedder": R.EMBEDDER}), encoding="utf-8")
    return 0


def topic_latency() -> int:
    """E6: how long one LLM call that names the topic of a statement takes, against the embedding step. Latency only."""
    import memoria
    from mlx_lm import generate
    from mlx_lm.sample_utils import make_sampler

    rows = R.read_lines(R.BENCH_FILE)
    probes = rows[:: len(rows) // TOPIC_PROBES][:TOPIC_PROBES]
    model, tokenizer = memoria.load_model()
    embedder = R.Embedder()

    def topic(statement: str) -> str:
        messages = [{"role": "user", "content": TOPIC_PROMPT.format(statement=statement)}]
        prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        return generate(model, tokenizer, prompt=prompt, max_tokens=8, sampler=make_sampler(temp=0.0), prefill_step_size=memoria.PREFILL_STEP).strip()

    topic("Let us get started, everyone.")
    embedder.encode(["warm up"])
    llm, step, named = [], [], []
    for probe in probes:
        started = time.perf_counter()
        named.append(topic(probe["statement"]))
        llm.append((time.perf_counter() - started) * 1000)
        started = time.perf_counter()
        embedder.encode([probe["statement"]])
        step.append((time.perf_counter() - started) * 1000)
    record = {"statements": len(probes), "llm_topic_call_ms": {"p50": float(np.percentile(llm, 50)), "p95": float(np.percentile(llm, 95))},
              "embedding_step_ms": {"p50": float(np.percentile(step, 50)), "p95": float(np.percentile(step, 95))}, "topics_named": named[:10]}
    (OUT / "topic_latency.json").write_text(json.dumps(record, indent=1), encoding="utf-8")
    print(json.dumps(record, indent=1))
    return 0


# --- the parent --------------------------------------------------------------------------------------------------

def run_worker(system: str, split: str, limit: int | None, smoke: bool) -> bool:
    command = [sys.executable, str(Path(__file__).resolve()), "--worker", system, "--split", split]
    if limit:
        command += ["--limit", str(limit)]
    if smoke:
        command += ["--smoke"]
    environment = {**os.environ, "HF_HUB_OFFLINE": "1", "PYTHONUNBUFFERED": "1", "TOKENIZERS_PARALLELISM": "false"}
    return subprocess.run(command, env=environment).returncode == 0


def run(args) -> int:
    systems = [s.strip() for s in args.systems.split(",") if s.strip()]
    unknown = [s for s in systems if s not in SYSTEMS]
    if unknown:
        print(f"unknown system(s): {unknown}; choose from {list(SYSTEMS)}", file=sys.stderr)
        return 2
    if args.split == "dev" and any(s.split("@")[1] != "C0" for s in systems):
        print("the development split has only condition C0", file=sys.stderr)
        return 2
    if not CONFIG.exists():
        print("refused: run tune first", file=sys.stderr)
        return 1
    if args.split == "test" and not args.smoke:
        if broken := R.verify_freeze():
            print(f"refused: {broken}", file=sys.stderr)
            return 1
        if problem := prereg_problem():
            print(f"refused: {problem}", file=sys.stderr)
            return 1
    if busy := busy_model_processes():
        for pid, what, gb in busy:
            print(f"refused: process {pid} ({what}) holds {gb:.1f} GB of model memory. Two MLX models at once crash this Mac: quit it first.", file=sys.stderr)
        return 1
    subprocess.Popen(["caffeinate", "-i", "-w", str(os.getpid())])  # the Mac must not doze off mid-run
    folder = folder_for(args.split, args.smoke)
    for position, system in enumerate(systems):
        if args.fresh:
            for suffix in (".jsonl", ".meta.json"):
                (folder / f"{system}{suffix}").unlink(missing_ok=True)
        print(f"[{position + 1}/{len(systems)}] {system}", flush=True)
        began = time.monotonic()
        if not run_worker(system, args.split, args.limit, args.smoke):
            print(f"{system} failed", file=sys.stderr)
            return 1
        print(f"    done in {(time.monotonic() - began) / 60:.1f} min", flush=True)
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Topic-scoping experiment")
    parser.add_argument("command", nargs="?", choices=("prepare", "tune", "freeze", "run", "topic-latency"))
    parser.add_argument("--split", choices=("test", "dev"), default="test")
    parser.add_argument("--systems", default=",".join(SYSTEMS))
    parser.add_argument("--limit", type=int)
    parser.add_argument("--smoke", action="store_true", help="write to results/scoping/_smoke and skip the pre-registration check")
    parser.add_argument("--fresh", action="store_true")
    parser.add_argument("--worker", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.worker:
        return worker(args.worker, args.split, args.limit, args.smoke)
    if args.command == "prepare":
        record = prepare()
        print(f"wrote C1 and C2 for {len(record['series'])} series; generic stems {record['generic_stems']}")
        return 0
    if args.command == "tune":
        config = tune()
        print(f"k = {config['k']} ({config['rule_for_k']}); development recall by k: " + ", ".join(f"{k}: {v['found']}/{v['n']}" for k, v in config["development"]["sweep"]["rule"].items()))
        return 0
    if args.command == "freeze":
        print(json.dumps(freeze(), indent=1))
        return 0
    if args.command == "topic-latency":
        if busy := busy_model_processes():
            print(f"refused: {busy}", file=sys.stderr)
            return 1
        return topic_latency()
    if args.command == "run":
        return run(args)
    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
