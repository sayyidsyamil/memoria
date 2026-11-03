"""Research-local paths and explicit development-only loading (never scan held-out files)."""
import hashlib
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
HARNESS = ROOT / "research/model-improvements"
SCRATCH = Path("/private/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode/weight-edit-attribution")
OLD = ("ES2003", "TS3004")
NEW = ("ES2011", "IS1008", "TS3006")
REVISION = "32f3e8ecf65426fc3306969496342d504bfa13f3"
MODEL = Path.home() / ".cache/huggingface/hub/models--mlx-community--Qwen3.5-4B-MLX-4bit/snapshots" / REVISION
sys.path.insert(0, str(HARNESS))
import harness  # noqa: E402


def sha(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode()).hexdigest()


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x") as out:
        json.dump(value, out, indent=2, ensure_ascii=False, default=str)
        out.write("\n")


def load_dev(names=OLD + NEW):
    from memoria_engine.evaluation.dataset import parse_chain, parse_ask
    chains = []
    for name in names:
        if name not in OLD + NEW:
            raise ValueError(f"not an authorized development series: {name}")
        folder = ROOT / "research/ledger-engine/data/ami_v0" if name in OLD else HARNESS / "data/ami_new"
        path = folder / f"{name}.chain"
        chain = parse_chain(path.read_text(), str(path))
        chains.append(parse_ask(path.with_suffix(".ask").read_text(), chain, str(path.with_suffix(".ask"))))
    return chains


def offline_lm():
    from lm import LM
    return LM("4b", HERE / "data/cache-dev.jsonl", offline=True)
