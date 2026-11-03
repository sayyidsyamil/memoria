"""Recorded bounded extension after the first no-effect strength screen."""
import json

from context import HERE, sha256, write_new_json


def main():
    made = []
    for family in ("contrast", "repeat64"):
        original = HERE / "directions" / f"{family}_layer30_s1.json"
        base = json.loads(original.read_text())
        for strength in (4, 6):
            path = HERE / "directions" / f"{family}_layer30_s{strength}.json"
            spec = {**base, "strength": strength, "extension": "initial contrast s<=2 has no free-generation effect; fixed-prefix causal screen first"}
            write_new_json(path, spec)
            made.append({"path": str(path.relative_to(HERE)), "sha256": sha256(path.read_bytes())})
        for strength in (1, 2, 4, 6):
            path = HERE / "directions" / f"{family}_layer30_random_output_s{strength}.json"
            spec = {**base, "strength": strength, "u_key": "random_u", "v_key": "v",
                    "control": "random_output_same_input_axis_equal_weight_and_per_input_perturbation_norm"}
            write_new_json(path, spec)
            made.append({"path": str(path.relative_to(HERE)), "sha256": sha256(path.read_bytes())})
    write_new_json(HERE / "results" / "grid_extension.json", {"files": made})


if __name__ == "__main__":
    main()
