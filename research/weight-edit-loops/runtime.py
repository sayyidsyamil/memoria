"""Model lifetime helpers. Call model work only under the external exclusive lease."""
import gc
import os
import re
import signal
import subprocess
import time

from context import HERE, SCRATCH, assert_frozen_sources


def reset_shared():
    import model_server
    model_server._prefix.update(ids=None, state=None, seen=None)
    model_server._meeting.update(ids=None, state=None)


def check_foreign():
    expression = re.compile(r"/Memoria\.app/Contents/MacOS/|(?:^|[ /])(?:model_server|resident_server)\.py(?: |$)|mlx_lm\.server|transcribe\.py --resident")
    busy = [line.strip() for line in subprocess.check_output(["ps", "-axo", "pid=,command="], text=True).splitlines()
            if expression.search(line) and int(line.split()[0]) != os.getpid()]
    if busy:
        raise RuntimeError("Refusing a model load beside resident/user processes: " + repr(busy))


def load_model():
    assert_frozen_sources()
    check_foreign()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    from lm import LM
    # LM.load uses worker_lifetime.limit_gpu_cache (256 MiB), pinned revision, local files only.
    lm = LM("4b", SCRATCH / "unused-cache.jsonl")
    lm.load()
    reset_shared()
    return lm


def close_model(lm):
    reset_shared()
    lm.close()
    gc.collect()
    import mlx.core as mx
    mx.clear_cache()


def hard_deadline(seconds=475):
    def expired(_signal, _frame):
        raise TimeoutError("Owned model lease reached its hard deadline")
    signal.signal(signal.SIGALRM, expired)
    signal.alarm(seconds)


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")
