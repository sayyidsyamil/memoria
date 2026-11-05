"""Same as run_ami.py, with the speed-only prefix-reuse wrapper (fastllm.py) in place of CachingMLX."""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1]))

import memoria_engine.llmcache as llmcache  # noqa: E402
from fastllm import FastCachingMLX  # noqa: E402

llmcache.CachingMLX = FastCachingMLX

import run_ami  # noqa: E402

if __name__ == "__main__":
    run_ami.main()
