"""Round-2-only outputs, with frozen round-1 helpers read-only."""
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
R1 = HERE.parent
sys.path.insert(0, str(R1))
from common import ROOT, HARNESS, MODEL, REVISION, load_dev, harness, sha  # noqa: E402

SCRATCH = Path("/private/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode/weight-edit-attribution/round2")


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x") as out:
        json.dump(value, out, indent=2, ensure_ascii=False, default=str)
        out.write("\n")


def verify_round1():
    manifest = json.loads((R1 / "artifact-hashes.json").read_text())
    for name, digest in manifest.items():
        assert sha((R1 / name).read_bytes()) == digest, name
    return len(manifest)
