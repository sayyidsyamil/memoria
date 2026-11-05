"""Integrity self-checks, no model: python3.11 test_integrity.py

1. Reserved data: loading development series opens only those series' own files; with every reserved (new-val)
   file denied at Python's file-open audit event, development loading and the cached dev/audit summaries still work.
2. Pinned baseline: every app module the harness imports comes from pinned/f45bbe549 (the v0.3.1-uat files), and a
   changed pinned file stops the harness.
"""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
import harness  # noqa: E402
import pinned  # noqa: E402

HERE = Path(__file__).resolve().parent
RESERVED = [str((HERE / "data" / "ami_new" / f"{s}.{ext}").resolve()) for s in harness.SPLITS["new-val"]["series"] for ext in ("chain", "ask")]
OPENED, DENY = [], [False]


def _audit(event, args):
    """Every file open in this process (builtins.open, io.open, os.open, Path.read_*) raises the "open" audit event."""
    if event == "open" and args and isinstance(args[0], (str, bytes, Path)):
        path = str(Path(args[0].decode() if isinstance(args[0], bytes) else args[0]).resolve())
        OPENED.append(path)
        if DENY[0] and path in RESERVED:
            raise PermissionError(f"reserved validation file opened: {path}")


sys.addaudithook(_audit)


class ReservedData(unittest.TestCase):
    def setUp(self):
        OPENED.clear()

    def test_new_dev_opens_only_its_own_files(self):
        harness.load_series(harness.series_of("new-dev"))
        in_folder = sorted({Path(p).name for p in OPENED if Path(p).parent == (HERE / "data" / "ami_new").resolve()})
        want = sorted(f"{s}.{ext}" for s in harness.series_of("new-dev") for ext in ("chain", "ask"))
        self.assertEqual(in_folder, want)
        self.assertFalse(set(OPENED) & set(RESERVED))

    def test_new_val_is_refused_before_any_open(self):
        with self.assertRaises(SystemExit):
            harness.load_series(["ES2002"])
        self.assertFalse(set(OPENED) & set(RESERVED))

    def test_exact_reader_matches_the_engine_loader(self):
        from memoria_engine.evaluation.dataset import load_chains
        with tempfile.TemporaryDirectory() as tmp:  # only development files in the folder the engine loader lists
            for s in harness.series_of("new-dev"):
                for ext in ("chain", "ask"):
                    shutil.copy(HERE / "data" / "ami_new" / f"{s}.{ext}", tmp)
            engine = {c.chain_id: c for c in load_chains(tmp)}
        for chain in harness.load_series(harness.series_of("new-dev")):
            self.assertEqual(chain, engine[chain.chain_id])
        for chain in harness.load_series(harness.series_of("old-dev,old-test") + ["demo"]):
            folder = harness.DATA["demo" if chain.chain_id == "demo" else "old"]
            self.assertEqual(chain, next(c for c in load_chains(str(folder)) if c.chain_id == chain.chain_id))

    def test_dev_and_audit_summaries_reproduce_with_reserved_files_denied(self):
        import baseline_audit
        import dev_tables
        DENY[0] = True
        try:
            with tempfile.TemporaryDirectory() as tmp:
                dev_tables.main(Path(tmp) / "summary.json")
                baseline_audit.main(Path(tmp) / "audit.json")
                for fresh, kept in (("summary.json", HERE / "results" / "dev" / "summary.json"),
                                    ("audit.json", HERE / "results" / "baseline-audit.json")):
                    self.assertEqual(json.loads((Path(tmp) / fresh).read_text()), json.loads(kept.read_text()), fresh)
        finally:
            DENY[0] = False
        self.assertFalse(set(OPENED) & set(RESERVED))


class PinnedBaseline(unittest.TestCase):
    def test_app_modules_come_from_the_pinned_copy(self):
        import ask_facts  # noqa: F401
        import live_guard  # noqa: F401
        import numwords
        import temporal_service
        from lm import LM  # noqa: F401  (imports nothing more until a model is used)
        numwords.repaired  # noqa: B018
        self.assertEqual(Path(temporal_service.__file__).parent, pinned.PIN)
        used = pinned.check_imported()
        self.assertIn("temporal_service", used)
        manifest = pinned.verify()
        self.assertEqual(manifest["identical_release_tag"], "v0.3.1-uat")

    def test_a_changed_pinned_file_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp) / "f45bbe549"
            shutil.copytree(pinned.PIN, copy)
            (copy / "temporal_service.py").write_text((copy / "temporal_service.py").read_text() + "\n# changed\n")
            original = pinned.PIN
            pinned.PIN = copy
            try:
                with self.assertRaises(SystemExit):
                    pinned.verify()
            finally:
                pinned.PIN = original


if __name__ == "__main__":
    unittest.main(verbosity=2)
