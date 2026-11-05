"""New qualification files, read-only imports from the accepted archived study."""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ARCHIVE = HERE.parent
if str(ARCHIVE) not in sys.path:
    sys.path.insert(0, str(ARCHIVE))

from context import assert_frozen_sources, sha256, write_new_json  # noqa: E402

ARCHIVE_COMMIT = "42ad04c4489e48a4b83a36fb26e4657ce7d79fae"
ARCHIVE_MANIFEST_SHA = "0d1a4ef6f10f907c83a1cec30a194f211ff957fdbcc1ba7457cd6c7f99664a6f"
EDIT = "directions/structural_layer31_s2.json"
CONTROL = "directions/structural_layer31_random_output_s2.json"
PROMPT_ID = "TS3006d.w0"


def verify_archive():
    path = ARCHIVE / "MANIFEST.json"
    assert sha256(path.read_bytes()) == ARCHIVE_MANIFEST_SHA
    files = json.loads(path.read_text())["files"]
    for name, digest in files.items():
        assert sha256((ARCHIVE / name).read_bytes()) == digest, name
    assert_frozen_sources()
    return {"commit": ARCHIVE_COMMIT, "manifest_sha256": ARCHIVE_MANIFEST_SHA,
            "verified_original_files": len(files), "new_subfolder_excluded_from_old_manifest": True}


def frozen():
    plan = json.loads((HERE / "frozen.json").read_text())
    verify_archive()
    for name, digest in plan["frozen_file_hashes"].items():
        assert sha256((ARCHIVE / name).read_bytes()) == digest, name
    for name in (EDIT, CONTROL):
        assert json.loads((ARCHIVE / name).read_text())["strength"] == 2
    return plan
