"""Freeze existing artifacts and first-stage source controls before inference."""
import json
import subprocess

from qual_common import ARCHIVE, CONTROL, EDIT, HERE, PROMPT_ID, verify_archive, sha256, write_new_json
from context import ROOT, prompt_rows
from qual_checks import SOURCE_CONTROLS, analyse


def main():
    import numpy as np
    archive = verify_archive()
    row = next(r for r in prompt_rows() if r["id"] == PROMPT_ID)
    edit, control = (json.loads((ARCHIVE / name).read_text()) for name in (EDIT, CONTROL))
    assert edit["strength"] == control["strength"] == 2
    assert control["v_key"] == "v" and control["u_key"] == "random_u"
    arrays = np.load(ARCHIVE / edit["direction_file"], allow_pickle=False)
    assert sha256(arrays["u"].tobytes()) == edit["u_sha256"]
    assert sha256(arrays["v"].tobytes()) == edit["v_sha256"]
    assert abs(float(np.linalg.norm(arrays["u"]) - np.linalg.norm(arrays["random_u"]))) < 1e-6
    audit = analyse(row, row["reference"]["text"])
    assert set(audit["source_control_hits"]) == {c["id"] for c in SOURCE_CONTROLS}
    names = [EDIT, CONTROL, edit["direction_file"], "data/diagnostics.json", "data/dev_prompts.jsonl",
             "data/reference_cache.jsonl", "data/cross_task_probes.json", "data/preservation_anchors.json",
             "results/frozen_source_check.json"]
    ancestral = {}
    for name in ("src-tauri/resources/memory/model_server.py", "src-tauri/resources/memory/temporal_service.py",
                 "src-tauri/resources/memory/memoria_engine/pipeline.py"):
        old = subprocess.check_output(["git", "show", f"f45bbe549:{name}"], cwd=ROOT)
        ancestral[name] = {"matches_f45bbe549": old == (ROOT / name).read_bytes(), "as_run_sha256": sha256((ROOT / name).read_bytes())}
    diagnostics = json.loads((ARCHIVE / "data" / "diagnostics.json").read_text())
    plan = {"archive": archive, "historical_source_revision": diagnostics["source_revision"],
            "original_coordinator_cache_sha256": diagnostics["source_sha256"],
            "owned_cache_snapshot_sha256": diagnostics["snapshot_sha256"],
            "frozen_file_hashes": {name: sha256((ARCHIVE / name).read_bytes()) for name in names},
            "edit": edit, "random_control": control, "active_random_u_sha256": sha256(arrays["random_u"].tobytes()),
            "edit_coefficient_frobenius": float(2 * np.linalg.norm(arrays["u"]) * np.linalg.norm(arrays["v"])),
            "control_coefficient_frobenius": float(2 * np.linalg.norm(arrays["random_u"]) * np.linalg.norm(arrays["v"])),
            "prompt_id": PROMPT_ID, "prompt_sha256": row["prompt_sha256"], "reference_key": row["reference"]["key"],
            "reference_text_sha256": sha256(row["reference"]["text"]),
            "conditions": ["base-before", "edit", "random", "base-after"],
            "source_controls": SOURCE_CONTROLS, "reference_audit": audit,
            "application_ancestor_check": ancestral,
            "active_harness": "owned historical225f709fd harness via archived context; newer coordinatorac5e7d29d not imported"}
    write_new_json(HERE / "frozen.json", plan)
    print(json.dumps({"archive": archive, "prompt": PROMPT_ID, "source_controls": audit["source_control_hits"],
                      "coefficient_norm": plan["edit_coefficient_frobenius"], "f45_checks": ancestral}, indent=2))


if __name__ == "__main__":
    main()
