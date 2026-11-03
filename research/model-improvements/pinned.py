"""The historical app path this folder measures: Memoria's own app modules at f45bbe549, byte-identical (git blobs) to
the v0.3.1-uat release tag, archived under pinned/f45bbe549 and put first on this process's import path, so "app"
means the 0.3.1 app path wherever the folder is checked out (on main, temporal_service.py and live_assistance.py have
changed since). Everything else the harness reads (the protected engine, October's scripts and data, the cached
results the audit compares) is verified in place against the hashes it had at f45bbe549.

    python3.11 pinned.py build    # once: archive the files from git and write pinned/f45bbe549/MANIFEST.json
    python3.11 pinned.py verify   # every pinned and in-place hash

`activate()` is called by harness.py and lm.py before any app module is imported. It changes only the importing
process's sys.path (never a production file or another worktree) and refuses to run if an app module was already
imported from somewhere else. A future current-production baseline needs its own pinned directory and name.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
COMMIT = "f45bbe54919adcd95c1d98d2794e27cca6087548"
TAG = "v0.3.1-uat"
PIN = HERE / "pinned" / "f45bbe549"
APP = ("temporal_service", "temporal_support", "model_server", "worker_lifetime", "live_guard", "live_assistance",
       "ask_facts", "qwen_scoring")
UNUSED = ("engine", "meetings_service", "private_storage")  # app modules the harness must never import
IN_PLACE = ["src-tauri/resources/memory/memoria_engine", "research/ledger-engine/scripts/ami",
            "research/ledger-engine/data/ami_v0", "research/ledger-engine/data/demo/demo.chain",
            "research/ledger-engine/results/cache/ami_dev_memoria.jsonl", "research/ledger-engine/results/cache/ami_test_memoria.jsonl",
            "research/ledger-engine/results/ami/memoria_dev.json", "research/ledger-engine/results/ami/memoria_test.json",
            "research/ledger-engine/results/ami/memoria_test_review.json", "research/ledger-engine/results/ami/baselines_test.json",
            "research/strong-model/results/memoria_test.json", "research/strong-model/results/baselines_test.json",
            "research/app-parity/results-replay.json", "research/memoriabench/app_live_check_bench.py",
            "research/memoriabench/eval_metrics.py", "research/memoriabench/stat_tests.py",
            "research/memoriabench/ami_loader.py", "research/memoriabench/generate_bench.py"]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def git(*args):
    return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True, check=True).stdout


def build():
    PIN.mkdir(parents=True, exist_ok=True)
    pinned = {}
    for name in APP:
        source = f"src-tauri/resources/memory/{name}.py"
        blob = git("rev-parse", f"{COMMIT}:{source}").strip()
        if blob != git("rev-parse", f"{TAG}:{source}").strip():
            raise SystemExit(f"{source} differs between {COMMIT[:9]} and {TAG}")
        data = subprocess.run(["git", "-C", str(ROOT), "show", f"{COMMIT}:{source}"], capture_output=True, check=True).stdout
        (PIN / f"{name}.py").write_bytes(data)
        pinned[f"{name}.py"] = {"source": source, "git_blob": blob, "sha256": hashlib.sha256(data).hexdigest()}
    in_place = {}
    for entry in IN_PLACE:
        listed = git("ls-tree", "-r", "--name-only", COMMIT, "--", entry).split()
        for rel in listed:
            data = subprocess.run(["git", "-C", str(ROOT), "show", f"{COMMIT}:{rel}"], capture_output=True, check=True).stdout
            in_place[rel] = hashlib.sha256(data).hexdigest()
    manifest = {"commit": COMMIT, "identical_release_tag": TAG, "pinned": pinned, "verified_in_place": in_place}
    (PIN / "MANIFEST.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"{len(pinned)} pinned, {len(in_place)} verified in place")


def verify():
    manifest = json.loads((PIN / "MANIFEST.json").read_text())
    broken = [name for name, info in manifest["pinned"].items() if sha(PIN / name) != info["sha256"]]
    broken += [rel for rel, digest in manifest["verified_in_place"].items() if not (ROOT / rel).exists() or sha(ROOT / rel) != digest]
    if broken:
        raise SystemExit(f"the historical app path ({COMMIT[:9]}) is not what this folder measured: {broken}")
    return manifest


def activate():
    """Pinned app modules first on sys.path, after checking every hash. Idempotent within a process."""
    if str(PIN) in sys.path:
        return
    verify()
    elsewhere = [m for m in APP + UNUSED if m in sys.modules and Path(getattr(sys.modules[m], "__file__", "") or "").parent != PIN]
    if elsewhere:
        raise SystemExit(f"app modules already imported from outside the pinned copy: {elsewhere}")
    sys.path.insert(0, str(PIN))


def check_imported():
    """Every app module this process has imported came from the pinned copy, and none of the unused ones was imported."""
    wrong = {m: getattr(sys.modules[m], "__file__", None) for m in APP if m in sys.modules
             and Path(sys.modules[m].__file__).parent != PIN}
    wrong.update({m: getattr(sys.modules[m], "__file__", None) for m in UNUSED if m in sys.modules})
    if wrong:
        raise SystemExit(f"app modules not from the pinned copy: {wrong}")
    return sorted(m for m in APP if m in sys.modules)


if __name__ == "__main__":
    if sys.argv[1:] == ["build"]:
        build()
    elif sys.argv[1:] == ["verify"]:
        manifest = verify()
        print(f"verified: {len(manifest['pinned'])} pinned app files ({COMMIT[:9]} = {TAG}), "
              f"{len(manifest['verified_in_place'])} files in place")
    else:
        raise SystemExit(__doc__)
