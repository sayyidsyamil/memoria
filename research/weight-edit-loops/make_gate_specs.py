"""One predeclared rectified gate, two strengths, one activation-matched control."""
import json

from context import HERE, write_new_json


def main():
    base = json.loads((HERE / "directions" / "contrast_layer30_s1.json").read_text())
    base = {k: v for k, v in base.items() if k not in ("formula", "family", "strength")}
    gate = {**base, "family": "rectified_contrast", "kind": "nonlinear_activation_adapter", "threshold": 2.0,
            "phase": "generated-token forwards only", "static_weight_equivalent": False}
    for strength in (12, 24):
        write_new_json(HERE / "directions" / f"gate_layer30_t2_s{strength}.json", {**gate, "strength": strength})
        write_new_json(HERE / "directions" / f"gate_layer30_t2_s{strength}_random_output.json",
                       {**gate, "strength": strength, "u_key": "random_u", "v_key": "v",
                        "control": "identical_gate_and_input_feature_random_unit_output_equal_per_input_norm"})


if __name__ == "__main__":
    main()
