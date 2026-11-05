"""Print a series' AMI human abstracts (DECISIONS first) with the sentence numbers specs use. No transcript text.

    python3.11 show_abstracts.py ES2011 [--all]
"""
import sys
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent / "ledger-engine" / "scripts" / "ami")]

import amilib  # noqa: E402
from build_gold import ANN  # noqa: E402

amilib.ANN = ANN
series, everything = sys.argv[1], "--all" in sys.argv
for letter in "abcd":
    meeting = series + letter
    if not (ANN / "abstractive" / f"{meeting}.abssumm.xml").exists():
        print(f"## {meeting}: no abstract")
        continue
    parts = amilib.abstract_sentences(meeting)
    print(f"## {meeting}")
    for tag in ("decisions", "abstract", "problems", "actions") if everything else ("decisions",):
        for sid, text in parts[tag]:
            print(f"  {tag[:3]} s{int(sid.split('.')[-1])}: {text}")
