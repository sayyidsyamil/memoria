#!/usr/bin/env python3
"""CLI entry for the Brain REPL (run from ``memoria/backend``).

  py brain_cli.py [options] [prompt]
  py -m brain.repl [options] [prompt]
"""
from __future__ import annotations

import sys
from pathlib import Path

_root = Path(__file__).resolve().parent
if str(_root) not in sys.path:
    sys.path.insert(0, str(_root))

from brain.repl import main  # noqa: E402

if __name__ == "__main__":
    main()
