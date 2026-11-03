"""Verify natural chat EOS from cached tokenizer metadata, not a guessed config ID."""
import argparse
import json
from pathlib import Path

from context import HERE, read_jsonl, sha256, write_new_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-path", type=Path)
    args = parser.parse_args()
    recorded = json.loads((HERE / "results" / "baseline-r1.meta.json").read_text())
    model = args.model_path or Path(recorded["load"]["path"])
    configuration = json.loads((model / "config.json").read_text())
    tokenizer_config = json.loads((model / "tokenizer_config.json").read_text())
    tokenizer = json.loads((model / "tokenizer.json").read_text())
    eos = tokenizer_config["eos_token"]
    eos_id = next(t["id"] for t in tokenizer["added_tokens"] if t["content"] == eos)
    checks = []
    for suffix in ("s2", "s4"):
        row = read_jsonl(HERE / "results" / f"structural-screen-structural_layer31_{suffix}.jsonl")[0]
        assert row["token_ids"][-1] == eos_id
        assert row["output_tokens"] == 149 and row["finish_reason"] == "stop" and not row["early_stopped"]
        assert row["raw_text"] == row["text"] and row["raw_clean"]
        checks.append({"condition": suffix, "tokens": 149, "last_token_id": row["token_ids"][-1],
                       "natural_tokenizer_eos": True, "synthetic_closure": False})
    result = {"tokenizer_eos_token": eos, "tokenizer_eos_id": eos_id,
              "text_config_eos_id": configuration["text_config"]["eos_token_id"],
              "correction": "An initial CPU assertion incorrectly assumed the text-config EOS248044 was the only EOS. The actual tokenizer chat EOS is im_end248046; recorded natural termination is confirmed.",
              "metadata_hashes": {f: sha256((model / f).read_bytes()) for f in ("config.json", "tokenizer_config.json", "tokenizer.json")},
              "checks": checks}
    write_new_json(HERE / "results" / "eos_token_audit.json", result)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
