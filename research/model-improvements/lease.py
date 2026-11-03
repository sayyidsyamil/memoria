"""Run one bounded model job while holding the machine-wide model lock, and record what it cost.

    python3.11 lease.py <label> -- <python> run.py <task> ...

The lock (`fcntl.flock`, exclusive, blocking in the kernel) is shared with the release work, so models never compete.
It is taken before the worker starts and released only after the worker has exited, i.e. after its weights are freed.
The worker runs under `/usr/bin/time -l`, which reports the process's peak memory footprint (unified memory included).
Refuses to start if Memoria.app or a resident model worker that this lease did not start is running.
Every lease is appended to results/leases.jsonl.
"""
import fcntl
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

LOCK = "/private/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode/memoria-model.lock"
HERE = Path(__file__).resolve().parent
LOG = HERE / "results" / "leases.jsonl"
FOREIGN = re.compile(r"/Applications/Memoria\.app/Contents/MacOS/|model_server\.py|resident_server\.py|mlx_lm\.server|transcribe\.py --resident")


def foreign_models():
    rows = subprocess.run(["ps", "-axo", "pid=,command="], capture_output=True, text=True).stdout.splitlines()
    return [row.strip() for row in rows if FOREIGN.search(row) and str(os.getpid()) != row.split()[0]]


def free_gb():
    stat = os.statvfs("/Users/sayyid")
    return stat.f_bavail * stat.f_frsize / 1e9


def main(argv):
    label, command = argv[0], argv[argv.index("--") + 1:]
    LOG.parent.mkdir(parents=True, exist_ok=True)
    asked = time.time()
    with open(LOCK, "a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        got = time.time()
        busy = foreign_models()
        record = {"label": label, "command": command, "asked": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(asked)),
                  "waited_s": round(got - asked, 1), "free_disk_gb": round(free_gb(), 1)}
        if busy:
            record.update(status="refused: another model process is running", processes=busy)
        elif record["free_disk_gb"] < 10:
            record.update(status="refused: under 10 GB of disk free")
        else:
            env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"}
            started = time.time()
            done = subprocess.run(["/usr/bin/time", "-l", *command], cwd=HERE, env=env, stderr=subprocess.PIPE, text=True)
            stderr = done.stderr
            peak = re.search(r"(\d+)\s+peak memory footprint", stderr)
            rss = re.search(r"(\d+)\s+maximum resident set size", stderr)
            record.update(status=f"exit {done.returncode}", seconds=round(time.time() - started, 1),
                          peak_footprint_gb=round(int(peak.group(1)) / 1e9, 3) if peak else None,
                          max_rss_gb=round(int(rss.group(1)) / 1e9, 3) if rss else None,
                          stderr_tail=stderr.strip().splitlines()[-25:])
            sys.stderr.write(stderr)
        record["released"] = time.strftime("%Y-%m-%d %H:%M:%S")
        fcntl.flock(handle, fcntl.LOCK_UN)
    with LOG.open("a") as out:
        out.write(json.dumps(record) + "\n")
    print(json.dumps({k: v for k, v in record.items() if k != "stderr_tail"}))
    return 0 if record["status"] == "exit 0" else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
