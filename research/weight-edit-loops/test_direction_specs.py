import json
import unittest

import numpy as np

from context import HERE, sha256


class DirectionArtifactTests(unittest.TestCase):
    def test_hashes_unit_norm_and_matched_random_edit_norms(self):
        for family, layer in (("contrast", 30), ("repeat64", 30), ("structural", 31)):
            spec = json.loads((HERE / "directions" / f"{family}_layer{layer}_s1.json").read_text())
            path = HERE / spec["direction_file"]
            arrays = np.load(path, allow_pickle=False)
            self.assertEqual(sha256(path.read_bytes()), spec["direction_sha256"])
            self.assertEqual(sha256(arrays["u"].tobytes()), spec["u_sha256"])
            self.assertEqual(sha256(arrays["v"].tobytes()), spec["v_sha256"])
            self.assertAlmostEqual(float(np.linalg.norm(arrays["u"])), 1.0, places=6)
            self.assertAlmostEqual(float(np.linalg.norm(arrays["random_u"])), 1.0, places=6)
            self.assertTrue(np.isfinite(arrays["u"]).all())
            self.assertTrue(np.isfinite(arrays["v"]).all())
            norm = np.linalg.norm(arrays["u"]) * np.linalg.norm(arrays["v"])
            control_norm = np.linalg.norm(arrays["random_u"]) * np.linalg.norm(arrays["random_v"])
            self.assertAlmostEqual(float(norm), float(control_norm), places=6)
            if family == "repeat64":
                self.assertEqual(int(np.count_nonzero(arrays["v"])), 64)
                np.testing.assert_array_equal(np.flatnonzero(arrays["v"]), np.flatnonzero(arrays["random_v"]))
            if family == "structural":
                self.assertEqual(int(np.count_nonzero(arrays["v"])), 512)
                np.testing.assert_array_equal(arrays["v"], arrays["random_v"])

    def test_teacher_forcing_matched_the_actual_greedy_path(self):
        probe = json.loads((HERE / "results" / "activation_probe.json").read_text())
        self.assertEqual([p["id"] for p in probe["prompts"]], ["TS3004b.w0", "TS3004b.w1"])
        for prompt in probe["prompts"]:
            self.assertEqual(prompt["greedy_mismatches"], [])

    def test_structural_derivation_is_finite_and_protection_is_explicit(self):
        from derive_structural import null_feature
        direction, info = null_feature(np.array([1., 2., 3., 4.]),
                                       np.array([[1., 0., 0., 0.], [0., 1., 0., 0.]]), np.arange(4))
        np.testing.assert_allclose(direction, [0., 0., .6, .8], atol=1e-6)
        self.assertEqual(info["control_rank"], 2)
        with self.assertRaises(ValueError):
            null_feature(np.array([1., 2., 0., 0.]),
                         np.array([[1., 0., 0., 0.], [0., 1., 0., 0.]]), np.arange(4))
        report = json.loads((HERE / "results" / "structural_derivation.json").read_text())
        self.assertLess(report["max_protected_feature"], 1e-5)
        for source in report["source"]:
            self.assertEqual(source["greedy_mismatches"], [])


if __name__ == "__main__":
    unittest.main()
