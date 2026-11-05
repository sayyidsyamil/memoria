"""One short real LFM3 extraction check; not a benchmark."""
import json
import time

from huggingface_hub import snapshot_download
from scripts.lfm3_bakeoff import preflight, REPO, REVISION
from scripts.hybrid_experiment import save
from scripts.model_bakeoff import ROOT


def main():
    runtime = preflight()
    path = snapshot_download(REPO, revision=REVISION,
                             allow_patterns=["*.json", "*.jinja", "*.safetensors", "configuration_lfm3.py"])
    from mlx_lm import load, generate
    from mlx_lm.sample_utils import make_sampler, make_logits_processors
    import mlx.core as mx

    model, tok = load(path)
    task = ('Extract only final decisions as JSON: {"decisions":[{"value":"...","quote":"..."}]}. '
            'Ignore tentative suggestions. Transcript: Sam: Maybe Acme could supply us. '
            'Lee: We have decided to use Beta as the supplier. This is final.')
    prompt = tok.apply_chat_template([{"role": "user", "content": task}],
                                    tokenize=False, add_generation_prompt=True, enable_thinking=False)
    start = time.perf_counter()
    output = generate(model, tok, prompt=prompt, max_tokens=256,
                      sampler=make_sampler(temp=0.1, top_k=50),
                      logits_processors=make_logits_processors(repetition_penalty=1.1), verbose=False)
    result = {"runtime": runtime, "thinking": False, "max_tokens": 256, "temperature": 0.1,
              "top_k": 50, "repetition_penalty": 1.1, "prompt": task, "raw": output,
              "seconds": time.perf_counter() - start, "mlx_peak_gb": mx.get_peak_memory() / 1e9}
    try:
        parsed = json.loads(output)
        result["passed"] = (len(parsed["decisions"]) == 1 and parsed["decisions"][0]["value"] == "Beta"
                            and parsed["decisions"][0]["quote"] in task)
    except (ValueError, KeyError, TypeError):
        result["passed"] = False
    save(ROOT / "results/model_bakeoff/lfm3_smoke.json", result)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
