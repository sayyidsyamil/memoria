"""Recompute a logged random-removal control (no model) with every reserved file denied, and compare it with the log.

    python3.11 recheck_controls.py logs/controls-1000-nosys.log
"""
import json
import sys

sys.dont_write_bytecode = True
import test_integrity  # noqa: E402  (installs the audit hook that records and can deny file opens)
import controls  # noqa: E402

FIELDS = ("base", "filter", "splits", "draws", "seed", "removed", "base_qa_tp_wrong", "filter_qa_tp_wrong", "random_qa_mean",
          "random_qa_p5_p90_p95", "random_tp_mean", "random_wrong_mean", "share_random_at_least_filter_qa", "passes")

if __name__ == "__main__":
    logged = json.loads(open(sys.argv[1]).read())
    test_integrity.DENY[0] = True
    fresh = controls.controls(logged["variant"], logged["base"], logged["filter"], logged["splits"], draws=logged["draws"], seed=logged["seed"])
    test_integrity.DENY[0] = False
    differ = {k: (logged[k], fresh[k]) for k in FIELDS if logged[k] != fresh[k]}
    reserved_opened = sorted(set(test_integrity.OPENED) & set(test_integrity.RESERVED))
    print(json.dumps({"log": sys.argv[1], "identical": not differ, "differ": differ, "reserved_files_opened": reserved_opened,
                      "recomputed": {k: fresh[k] for k in FIELDS}}))
