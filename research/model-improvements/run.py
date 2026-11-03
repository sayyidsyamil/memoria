"""Model jobs, each bounded to a lease of about ten minutes; run them through lease.py, which holds the model lock.

    lease.py <label> -- <python> run.py extract <variant> <mechanism> <series ...>
    lease.py <label> -- <python> run.py route <variant> <series ...>
    lease.py <label> -- <python> run.py guard <variant> dev
    lease.py <label> -- <python> run.py parity

Every model call goes to cache/<variant>.jsonl (lm.LM); score.py reads the cache with no model. A job stops starting new
series once `--minutes` (default 9) have passed; rerunning it continues from the cache.
"""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.dont_write_bytecode = True
import harness  # noqa: E402
from lm import APP_SYSTEM, LM  # noqa: E402

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache"


def budget_minutes(args):
    if "--minutes" in args:
        at = args.index("--minutes")
        minutes = float(args[at + 1])
        del args[at:at + 2]
        return minutes
    return 9.0


def extract(variant, mechanism, names, minutes, lm=None):
    lm, started = lm or LM(variant, CACHE / f"{variant}.jsonl"), time.time()
    for chain in harness.load_series(names):
        if time.time() - started > minutes * 60:
            print(f"time budget reached before {chain.chain_id}", flush=True)
            break
        t0 = time.time()
        run = harness.run_chain(chain, lm, mechanism)
        calls = run["calls"]
        print(json.dumps({"series": chain.chain_id, "mechanism": mechanism, "windows": len(calls),
                          "seconds": round(time.time() - t0, 1), "hit_budget": sum(c["hit_budget"] for c in calls),
                          "unclean": sum(not c["parsed_cleanly"] for c in calls), "misses": lm.misses, "hits": lm.hits,
                          **lm.load_info}), flush=True)
    return lm


def route(variant, names, minutes, lm=None):
    from memoria_engine.evaluation import baselines
    from memoria_engine.evaluation.router import build_prompt
    lm, started = lm or LM(variant, CACHE / f"{variant}.jsonl"), time.time()
    for chain in harness.load_series(names):
        if time.time() - started > minutes * 60:
            print(f"time budget reached before {chain.chain_id}", flush=True)
            break
        today = baselines.today_iso(chain)
        for q in chain.questions:
            lm.app_generate(build_prompt(chain.registry, today, q.ask), 1800, APP_SYSTEM, tag=f"route:{chain.chain_id}:{q.qid}")
        print(json.dumps({"series": chain.chain_id, "questions": len(chain.questions), "misses": lm.misses, "hits": lm.hits}), flush=True)
    return lm


def guard(variant, split, lm=None):
    sys.path.insert(0, str(harness.ROOT / "research" / "memoriabench"))
    os.environ.pop("MEMORIA_EMBED_SOCKET", None)  # lexical candidates only: no embedding model is loaded
    os.environ["MEMORIA_LIVE_CHECK"] = "guard"
    import live_assistance  # noqa: F401  (the pinned 0.3.1 copy; the bench below would otherwise import the checkout's)
    import temporal_support  # noqa: F401
    import app_live_check_bench as bench
    import pinned
    pinned.check_imported()
    lm = lm or LM(variant, CACHE / f"{variant}.jsonl")
    probes, provenance, memories = bench.load_inputs(split)
    current = {}

    def scorer(messages):
        record = lm.score(messages, tag=f"guard:{split}:{current.get('id')}")
        return record["logprobs"]["YES"] - record["logprobs"]["NO"]

    def no_verifier(statement, facts):
        raise AssertionError("guard mode never asks for a written verdict")

    rows = []
    for probe in probes:
        current["id"] = probe["id"]
        rows += bench.run([probe], memories, provenance, verifier=no_verifier, scorer=scorer)
    out = HERE / "results" / "guard" / f"{variant}.{split}.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    if not out.exists():
        with out.open("x") as handle:
            for row in rows:
                handle.write(json.dumps(bench.finite_json(row), ensure_ascii=False) + "\n")
    print(json.dumps({"variant": variant, "split": split, **bench.summarise(rows), "misses": lm.misses, "hits": lm.hits, **lm.load_info}))
    return lm


def parity():
    """The app's own worker (model_server.py, the 4B) against lm.LM on the same requests, one model at a time."""
    from memoria_engine.evaluation import baselines
    from memoria_engine.evaluation.router import build_prompt as route_prompt
    from memoria_engine.extractors import build_prompt
    from memoria_engine.pipeline import Meeting, MeetingContext
    import live_guard
    chains = harness.load_series(["ES2003", "TS3004"])
    requests = []
    for chain in chains:
        gm = chain.meetings[0]
        windows = harness.WindowedExtractor(None).windows(gm.meeting)
        sub = Meeting(gm.meeting.meeting_id, gm.meeting.occurred_at, gm.meeting.ingested_at, tuple(gm.meeting.turns[i] for i in windows[0]))
        requests.append({"prompt": build_prompt(MeetingContext(sub, chain.registry, {}))})
        requests.append({"prompt": route_prompt(chain.registry, baselines.today_iso(chain), chain.questions[0].ask)})
    scores = [{"type": "score", "messages": live_guard.question("We will go with a kinetic battery.", "Battery type is rechargeable. Approved quote: we'll use rechargeable batteries."), "candidates": ["YES", "NO"]},
              {"type": "score", "messages": live_guard.question("The case is plastic.", "Case material is plastic. Approved quote: plastic casing."), "candidates": ["YES", "NO"]}]
    address = tempfile.mktemp(prefix="mi-", suffix=".sock", dir="/private/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode")
    import pinned
    server = subprocess.Popen([sys.executable, str(pinned.PIN / "model_server.py"), address, "--resident"],
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
                              env={**os.environ, "MEMORIA_LLM_MODEL": "mlx-community/Qwen3.5-4B-MLX-4bit",
                                   "PYTHONPATH": str(harness.MEMORY)})  # the engine; app modules come from the script's own (pinned) folder
    try:
        ready = server.stdout.readline()
        print("worker", ready.strip(), flush=True)
        worker = []
        for request in requests + scores:
            with socket.socket(socket.AF_UNIX) as connection:
                connection.connect(address)
                connection.sendall((json.dumps(request) + "\n").encode())
                for line in connection.makefile("r"):
                    reply = json.loads(line)
                    if "progress" not in reply:
                        worker.append(reply)
                        break
    finally:
        server.terminate()
        server.wait(timeout=60)
    lm = LM("4b", CACHE / "4b-parity.jsonl")
    mine = [{"text": lm.app_generate(r["prompt"], 1800, APP_SYSTEM, tag="parity")["text"]} for r in requests]
    mine += [{"logprobs": lm.score(r["messages"], tag="parity")["logprobs"]} for r in scores]
    same = [a == b for a, b in zip(worker, mine)]
    print(json.dumps({"identical": same, "worker": worker, "in_process": mine}, ensure_ascii=False)[:4000])
    print("PARITY IDENTICAL" if all(same) else "PARITY DIFFERS")
    return lm


def thinkcheck(variant, n=10, max_tokens=4096):
    """Is the edit active here? Thinking on, as in the post's evaluation but without its presence penalty (MLX's version
    also counts prompt tokens): GSM8K train problems (openai/gsm8k @ 740312a, MIT), one seeded sample each."""
    import mlx.core as mx
    from mlx_lm import stream_generate
    from mlx_lm.sample_utils import make_sampler
    problems = json.loads((HERE / "data" / "gsm8k_train_12.json").read_text())[:n]
    lm = LM(variant, CACHE / f"{variant}-thinkcheck.jsonl")
    lm.load()
    out = HERE / "results" / "thinkcheck" / f"{variant}.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for i, p in enumerate(problems):
        mx.random.seed(i)
        messages = [{"role": "user", "content": p["question"] + "\nPlease reason step by step, and put your final answer within \\boxed{}."}]
        prompt = lm.tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=True)
        text, last, started = "", None, time.perf_counter()
        for response in stream_generate(lm.model, lm.tokenizer, prompt=prompt, max_tokens=max_tokens,
                                        sampler=make_sampler(temp=0.6, top_p=0.95, top_k=20)):
            text += response.text
            last = response
        import re
        boxed = re.findall(r"\\boxed\{([^{}]*)\}", text.split("</think>")[-1])
        rows.append({"i": i, "tokens": last.generation_tokens, "hit_limit": last.generation_tokens >= max_tokens,
                     "closed_thinking": "</think>" in text, "answer": boxed[-1] if boxed else None, "gold": p["answer"],
                     "correct": bool(boxed) and boxed[-1].replace(",", "").strip() == p["answer"],
                     "seconds": round(time.perf_counter() - started, 1), "tail": text[-300:]})
        print(json.dumps({k: v for k, v in rows[-1].items() if k != "tail"}), flush=True)
    with out.open("a") as handle:
        for row in rows:
            handle.write(json.dumps({"variant": variant, **row}) + "\n")
    return lm


if __name__ == "__main__":
    args = sys.argv[1:]
    minutes = budget_minutes(args)
    task = args[0]
    if task == "extract":
        used = extract(args[1], args[2], args[3:], minutes)
    elif task == "route":
        used = route(args[1], args[2:], minutes)
    elif task == "guard":
        used = guard(args[1], args[2])
    elif task == "parity":
        used = parity()
    elif task == "thinkcheck":
        used = thinkcheck(args[1])
    elif task == "suite":
        # one lease, one model load: guard on bench-dev, routes and extraction on the given series
        variant, names = args[1], args[2:]
        started = time.time()
        used = guard(variant, "dev")
        route(variant, names, minutes, lm=used)
        extract(variant, "app", names, max(0.5, minutes - (time.time() - started) / 60), lm=used)
    else:
        raise SystemExit(__doc__)
    used.close()
