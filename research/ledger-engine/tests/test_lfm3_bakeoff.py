import unittest

from scripts.lfm3_bakeoff import REPO, REVISION, require_runtime


class LFM3PreflightTests(unittest.TestCase):
    def test_old_and_prerelease_runtimes_fail_before_loading_model(self):
        for version in ("0.7.0", "0.7.7", "0.7.8rc1"):
            with self.assertRaisesRegex(RuntimeError, "requires mlx-optiq"):
                require_runtime(version)

    def test_supported_versions_pass_version_check(self):
        for version in ("0.7.8", "0.7.9", "0.8.0"):
            require_runtime(version)

    def test_checkpoint_is_pinned(self):
        self.assertEqual(REPO, "mlx-community/LFM3-1.7B-OptiQ-4bit")
        self.assertEqual(len(REVISION), 40)


if __name__ == "__main__":
    unittest.main()
