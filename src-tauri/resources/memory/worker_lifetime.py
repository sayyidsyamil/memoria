"""Resident workers belong to the app process that started them."""
import os
import threading
import time
from pathlib import Path


def exit_with_parent(address, interval=2.0, getppid=os.getppid, sleep=time.sleep, exit=os._exit):
    """A crashed app must not leave resident model weights behind. When the worker is re-parented
    (its app process died), remove its private socket and exit."""
    parent = getppid()

    def watch():
        while True:
            sleep(interval)
            if getppid() != parent:
                Path(address).unlink(missing_ok=True)
                exit(0)
                return

    thread = threading.Thread(target=watch, name='memoria-parent-watch', daemon=True)
    thread.start()
    return thread


GPU_CACHE_MB = 256


def limit_gpu_cache(megabytes=GPU_CACHE_MB):
    """MLX keeps every freed GPU buffer for reuse, without limit by default. Decoding speech windows of changing
    lengths, the speech worker grew to a 9.2 GB footprint this way (1.5 GB of it models) and the Mac went into swap:
    checks that take 0.2 s took 15 s. Cap what a worker may keep."""
    import mlx.core as mx
    mx.set_cache_limit(megabytes * 1024 * 1024)
