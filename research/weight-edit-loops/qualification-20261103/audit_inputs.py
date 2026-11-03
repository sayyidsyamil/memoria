"""Fresh-process, model-free audit of this qualification's exact dev input path."""
import importlib.metadata
import json
import sys
from pathlib import Path

from qual_common import HERE, frozen, sha256, write_new_json
from context import COORD, ROOT, prompt_rows


def main():
    plan = frozen()
    allowed = {(COORD / "data" / "ami_new" / f"TS3006.{suffix}").resolve() for suffix in ("chain", "ask")}
    opened = []

    def audit(event, arguments):
        if event != "open" or not isinstance(arguments[0], (str, bytes)):
            return
        path = Path(arguments[0].decode() if isinstance(arguments[0], bytes) else arguments[0])
        if path.suffix not in (".chain", ".ask", ".alt"):
            return
        path = path.resolve()
        if path not in allowed:
            raise AssertionError(f"Blocked qualification dataset open: {path}")
        opened.append(str(path.relative_to(ROOT)))

    sys.addaudithook(audit)
    import harness

    def blocked(*_args, **_kwargs):
        raise AssertionError("Directory-based series loading is forbidden here")
    harness.load_series = harness.load_chains = blocked
    from qual_checks import analyse
    row = next(r for r in prompt_rows() if r["id"] == plan["prompt_id"])
    result = analyse(row, row["reference"]["text"])
    assert result == plan["reference_audit"]
    assert len(set(opened)) == 2
    record = {"scope": "qualification CPU replay with non-TS3006 chain/ask opens denied; not a claim about other sessions' parsing",
              "opened": opened, "directory_loader_disabled": True, "reference_audit_reproduced": True,
              "source_controls": result["source_control_hits"], "newval_generation_or_scoring": False,
              "harness_path": str(Path(harness.__file__).resolve()),
              "harness_sha256": sha256(Path(harness.__file__).read_bytes()),
              "versions": {p: importlib.metadata.version(p) for p in ("mlx", "mlx-lm", "transformers", "numpy")}}
    write_new_json(HERE / "results" / "input_audit.json", record)
    print(json.dumps(record, indent=2))


if __name__ == "__main__":
    main()
