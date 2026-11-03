import json
import unittest

import numpy as np

from context import HERE, sha256


class DirectionArtifactTests(unittest.TestCase):
    def test_hashes_unit_norm_and_matched_random_edit_norms(self):
        for family in ("contrast", "repeat64"):
            spec = json.loads((HERE / "directions" / f"{family}_layer30_s1.json").read_text())
            path = HERE / spec["direction_file"]
            arrays = np.load(path, allow_pickle=False)
            self.assertEqual(sha256(path.read_bytes()), spec["direction_sha256"])
            self.assertEqual(sha256(arrays["u"].tobytes()), spec["u_sha256"])
            self.assertEqual(sha256(arrays["v"].tobytes()), spec["v_sha256"])
            self.assertAlmostEqual(float(np.linalg.norm(arrays["u"])), 1.0, places=6)
            self.assertAlmostEqual(float(np.linalg.norm(arrays["random_u"])), 1.0, places=6)
            norm = np.linalg.norm(arrays["u"]) * np.linalg.norm(arrays["v"])
            control_norm = np.linalg.norm(arrays["random_u"]) * np.linalg.norm(arrays["random_v"])
            self.assertAlmostEqual(float(norm), float(control_norm), places=6)
            if family == "repeat64":
                self.assertEqual(int(np.count_nonzero(arrays["v"])), 64)
                np.testing.assert_array_equal(np.flatnonzero(arrays["v"]), np.flatnonzero(arrays["random_v"]))

    def test_teacher_forcing_matched_the_actual_greedy_path(self):
        probe = json.loads((HERE / "results" / "activation_probe.json").read_text())
        self.assertEqual([p["id"] for p in probe["prompts"]], ["TS3004b.w0", "TS3004b.w1"])
        for prompt in probe["prompts"]:
            self.assertEqual(prompt["greedy_mismatches"], [])


if __name__ == "__main__":
    unittest.main()
