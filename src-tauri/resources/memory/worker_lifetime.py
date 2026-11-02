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
