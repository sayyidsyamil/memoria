"""Verify archive/freeze integrity and resource release; create a qualification-only manifest."""
import json
import os
import re
import subprocess
from pathlib import Path

from qual_common import HERE, frozen, sha256, verify_archive, write_new_json
from context import ROOT
from runtime import now


def main():
    plan = frozen()
    decision = json.loads((HERE / "results" / "transfer_decision.json").read_text())
    source = json.loads((HERE / "results" / "source_audit_verdict.json").read_text())
    assert not decision["passed"] and source["outcome"] == "failed-collateral"
    freeze_commit = "64829416d"
    for name in ("AMENDMENT.md", "frozen.json", "qual_common.py", "qual_checks.py", "run_transfer.py"):
        relative = str((HERE / name).relative_to(ROOT))
        original = subprocess.check_output(["git", "show", f"{freeze_commit}:{relative}"], cwd=ROOT)
        assert original == (HERE / name).read_bytes(), name
    running = []
    for line in subprocess.check_output(["ps", "-axo", "pid=,command="], text=True).splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) != 2 or parts[0] == str(os.getpid()):
            continue
        command = parts[1]
        executable = Path(command.split(None, 1)[0]).name.lower()
        if (executable.startswith("python") or executable == "time") and "qualification-20261103/run_transfer.py" in command:
            running.append(line.strip())
    assert not running, running
    prefix = "research/weight-edit-loops/qualification-20261103/"
    changed = subprocess.check_output(["git", "diff", "--name-only", plan["archive"]["commit"]], cwd=ROOT, text=True).splitlines()
    untracked = subprocess.check_output(["git", "ls-files", "--others", "--exclude-standard"], cwd=ROOT, text=True).splitlines()
    assert all(p.startswith(prefix) for p in changed + untracked), changed + untracked
    log = (HERE / "results" / "transfer.log").read_text()
    seconds = float(re.search(r"(?m)^\s*(\d+(?:\.\d+)?)\s+real\s", log)[1])
    assert seconds < 480
    write_new_json(HERE / "results" / "closeout_checks.json", {
        "recorded": now(), "archive": verify_archive(), "freeze_commit": freeze_commit,
        "frozen_amendment_plan_and_executed_code_unchanged": True,
        "owned_transfer_workers_or_wrappers_running": running,
        "all_new_changes_within_qualification_subfolder": True,
        "model_leases_used": 1, "model_lease_seconds": seconds,
        "outcome": "failed-collateral", "planned_transfer_conditions_completed": 4,
        "additional_model_leases_after_transfer": 0})
    files = {str(p.relative_to(HERE)): sha256(p.read_bytes()) for p in sorted(HERE.rglob("*"))
             if p.is_file() and p.name != "QUALIFICATION_MANIFEST.json"}
    write_new_json(HERE / "QUALIFICATION_MANIFEST.json", {
        "archive_commit": plan["archive"]["commit"], "archive_manifest_sha256": plan["archive"]["manifest_sha256"],
        "freeze_commit": freeze_commit, "outcome": "failed-collateral", "files": files,
        "excluded": ["QUALIFICATION_MANIFEST.json"]})
    print(f"Failed-collateral handoff: {len(files)} new-file hashes; archive preserved; no owned model process")


if __name__ == "__main__":
    main()
