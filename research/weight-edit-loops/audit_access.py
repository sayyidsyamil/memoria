"""CPU-only, fresh-process input-access audit; unexpected chain/ask opens are blocked.

This verifies our replay path, not the coordinator's historical host parsing.
The broader coordinator load_series/load_chains entrypoints are disabled explicitly.
"""
import argparse
import json
import sys
from pathlib import Path

from context import ALLOWED, COORD, HERE, ROOT, assert_frozen_sources, load_chain, sha256, write_new_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="input_access_audit.json")
    args = parser.parse_args()
    assert_frozen_sources()
    allowed = set()
    for name in ALLOWED:
        folder = ROOT / "research" / "ledger-engine" / "data" / "ami_v0" if name in ALLOWED[:2] else COORD / "data" / "ami_new"
        for extension in ("chain", "ask"):
            allowed.add((folder / f"{name}.{extension}").resolve())
    opened = []

    def audit(event, arguments):
        if event != "open" or not isinstance(arguments[0], (str, bytes)):
            return
        path = Path(arguments[0].decode() if isinstance(arguments[0], bytes) else arguments[0])
        if path.suffix not in (".chain", ".ask", ".alt"):
            return
        path = path.resolve()
        if path not in allowed:
            raise AssertionError(f"Blocked non-allowlisted dataset open: {path}")
        opened.append(str(path.relative_to(ROOT)))

    sys.addaudithook(audit)
    import harness
    from lm import LM
    from score import summarise

    def forbidden_directory_loader(*_args, **_kwargs):
        raise AssertionError("Coordinator directory loader must not be used by this study")
    harness.load_series = forbidden_directory_loader
    harness.load_chains = forbidden_directory_loader
    lm = LM("4b", HERE / "data" / "reference_cache.jsonl", offline=True)
    scores = []
    for name in ALLOWED:
        chain = load_chain(name)
        scores.append(harness.score_chain(chain, harness.run_chain(chain, lm, "app")))
    summary = summarise(scores)
    assert lm.hits == 97 and lm.misses == 0
    assert (summary["tp"], summary["qa_exact"], summary["values"]["wrong"]) == (26, "90/124", 46)
    assert len(set(opened)) == 10
    result = {"scope": "fresh-process replay of this branch's exact-file access path; not a certification of other sessions or historical shared-cache contents",
              "validation_generation_or_scoring": False, "directory_loader_disabled": True,
              "dataset_opens": opened, "unique_dataset_files": sorted(set(opened)),
              "cache_hits": lm.hits, "cache_misses": lm.misses,
              "tp": summary["tp"], "qa_exact": summary["qa_exact"], "wrong_writes": summary["values"]["wrong"],
              "source": {f: sha256((HERE / f).read_bytes()) for f in ("context.py", "audit_access.py")}}
    write_new_json(HERE / "results" / args.out, result)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
