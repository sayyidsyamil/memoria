"""Read-only coordinator/engine imports and strictly development-only loading."""
import hashlib
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
COORD = ROOT / "research" / "model-improvements"
MEMORY = ROOT / "src-tauri" / "resources" / "memory"
SCRATCH = Path("/private/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode/weight-edit-loops")
ALLOWED = ("ES2003", "TS3004", "ES2011", "IS1008", "TS3006")
for path in (COORD, MEMORY):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))


def sha256(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode()).hexdigest()


def assert_frozen_sources():
    """Refuse silent replay against newer engine repairs after copying/merging this study."""
    expected = json.loads((HERE / "results" / "frozen_source_check.json").read_text())
    changed = [name for name, record in expected.items()
               if sha256((ROOT / name).read_bytes()) != record["sha256"]]
    if changed:
        raise RuntimeError("Frozen research baseline source mismatch: " + ", ".join(changed)
                           + ". Use the historical snapshot or explicitly register a new baseline.")
    return sorted(expected)


def load_chain(name):
    if name not in ALLOWED:
        raise ValueError(f"not an owned development series: {name}")
    from memoria_engine.evaluation.dataset import parse_ask, parse_chain
    folder = (ROOT / "research" / "ledger-engine" / "data" / "ami_v0"
              if name in ALLOWED[:2] else COORD / "data" / "ami_new")
    path = folder / f"{name}.chain"
    chain = parse_chain(path.read_text(), str(path))
    ask = path.with_suffix(".ask")
    if ask.exists():
        chain = parse_ask(ask.read_text(), chain, str(ask))
    return chain


def read_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]


def write_new_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x") as out:
        json.dump(value, out, ensure_ascii=False, indent=2)
        out.write("\n")


def prompt_rows(selected=True):
    rows = read_jsonl(HERE / "data" / "dev_prompts.jsonl")
    if selected:
        spec = json.loads((HERE / "data" / "diagnostics.json").read_text())
        by_id = {r["id"]: r for r in rows}
        rows = [{**by_id[s["id"]], "role": s["role"]} for s in spec["prompts"]]
    return rows
