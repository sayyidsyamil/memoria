"""Build AMI chains for new series with October's procedure, unchanged, writing only under this folder.

    python3.11 build_gold.py verify-october     # October's 7 chains rebuilt from the annotations: byte-identical?
    python3.11 build_gold.py build SERIES ...   # data/ami_new/<series>.chain, .ask and gold_<series>.md from specs_new.py
    python3.11 build_gold.py manifest           # data/manifest.json: SHA-256 of every built file, specs and annotations

`ledger-engine/scripts/ami/build_chains.py` and `amilib.py` are imported, not copied; only their module-level paths
(annotations, output folders) and the series table are pointed elsewhere. The annotations are the AMI manual
annotations 1.6.2 zip that MemoriaBench pinned, unpacked into a scratch folder (MEMORIA_AMI_ANNOTATIONS).
"""
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
LEDGER = HERE.parent / "ledger-engine"
sys.path[:0] = [str(LEDGER / "scripts" / "ami"), str(LEDGER), str(HERE)]

import amilib  # noqa: E402
import build_chains  # noqa: E402
import specs as october_specs  # noqa: E402

ZIP = Path.home() / "Library/Caches/Memoria/ami/ami_public_manual_1.6.2.zip"
ZIP_SHA256 = "b56e5babb2496b8795deeeda7e71178d7fbc9963f94276cf2a3f4b56ebbc9f9d"  # as pinned by memoriabench/ami_loader.py
ANN = Path(os.environ.get("MEMORIA_AMI_ANNOTATIONS",
                          "/private/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode/model-improvements/ami/annotations"))
OUT = HERE / "data" / "ami_new"


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def point(ann, out, report, table):
    amilib.ANN = build_chains.ANN = ann
    build_chains.OUT, build_chains.REPORT, build_chains.SPECS = out, report, table


def verify_october():
    if not ANN.is_dir():
        raise SystemExit(f"annotations not found: {ANN}")
    with tempfile.TemporaryDirectory() as tmp:
        point(ANN, Path(tmp), Path(tmp), october_specs.SPECS)
        same = True
        for team in october_specs.SPECS:
            build_chains.build(team)
            for suffix in (".chain", ".ask"):
                ok = (Path(tmp) / f"{team}{suffix}").read_bytes() == (LEDGER / "data" / "ami_v0" / f"{team}{suffix}").read_bytes()
                same &= ok
                print(f"{team}{suffix}: {'identical' if ok else 'DIFFERENT'}")
        print("OCTOBER REBUILD IDENTICAL" if same else "OCTOBER REBUILD DIFFERS")
        return same


def build(teams):
    import specs_new
    OUT.mkdir(parents=True, exist_ok=True)
    point(ANN, OUT, OUT, specs_new.SPECS)
    for team in teams:
        problems, events, questions, turns = build_chains.build(team)
        print(f"{team}: {events} gold events, {questions} questions, {turns} turns, {len(problems)} unresolved")
        for p in problems:
            print("   !", p)


def manifest():
    files = sorted(p for p in OUT.iterdir() if p.is_file())
    data = {"annotations_zip": {"path": str(ZIP), "sha256": sha256(ZIP), "expected": ZIP_SHA256},
            "specs_new.py": sha256(HERE / "specs_new.py"),
            "build_chains.py": sha256(LEDGER / "scripts" / "ami" / "build_chains.py"),
            "amilib.py": sha256(LEDGER / "scripts" / "ami" / "amilib.py"),
            "files": {p.name: sha256(p) for p in files}}
    (HERE / "data" / "manifest.json").write_text(json.dumps(data, indent=1) + "\n")
    print(json.dumps(data, indent=1))


if __name__ == "__main__":
    if sha256(ZIP) != ZIP_SHA256:
        raise SystemExit("AMI annotations zip does not match the pinned SHA-256")
    command, rest = sys.argv[1], sys.argv[2:]
    if command == "verify-october":
        raise SystemExit(0 if verify_october() else 1)
    if command == "build":
        build(rest)
    elif command == "manifest":
        manifest()
    else:
        raise SystemExit(__doc__)
