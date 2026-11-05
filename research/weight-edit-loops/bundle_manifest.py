"""Create once, or verify, the closed research bundle's SHA-256 manifest."""
import argparse
import json

from context import HERE, assert_frozen_sources, sha256, write_new_json


def files():
    return {str(p.relative_to(HERE)): sha256(p.read_bytes()) for p in sorted(HERE.rglob("*"))
            if p.is_file() and p.name != "MANIFEST.json"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    assert_frozen_sources()
    path = HERE / "MANIFEST.json"
    actual = files()
    if args.verify:
        recorded = json.loads(path.read_text())["files"]
        assert actual == recorded, "Research bundle changed after manifest creation"
        print(f"Verified {len(actual)} file hashes and five historical baseline sources")
    else:
        diagnostics = json.loads((HERE / "data" / "diagnostics.json").read_text())
        write_new_json(path, {"historical_source_revision": diagnostics["source_revision"],
                             "model": "mlx-community/Qwen3.5-4B-MLX-4bit",
                             "model_revision": "32f3e8ecf65426fc3306969496342d504bfa13f3",
                             "excluded": ["MANIFEST.json"], "files": actual})
        print(f"Recorded {len(actual)} file hashes; manifest SHA-256 {sha256(path.read_bytes())}")


if __name__ == "__main__":
    main()
