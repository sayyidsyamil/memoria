"""Summarise the completed LFM3 experiments and audit budget exhaustion."""
import json

from scripts.model_bakeoff import ROOT
from scripts.hybrid_experiment import save


def main():
    base = ROOT / "results/model_bakeoff"
    reference = json.loads((ROOT / "results/ami/memoria_dev.json").read_text())["memoria"]
    lines = ["# LFM3 versus Qwen: completed development experiments", "",
             "Same 8 AMI development meetings and 45 questions. Qwen uses the stored prior evaluated run.", "",
             "| Configuration | QA | Current | Extraction recall | Router exact | Extraction s/meeting |", "|---|---:|---:|---:|---:|---:|"]
    rows = [("Qwen reference", reference)]
    audits = {}
    for folder, label in (("lfm3_optiq_dev", "LFM3 drop-in, thinking requested off"),
                          ("lfm3_adapted_dev", "LFM3 reasoning, larger budget")):
        result = json.loads((base / folder / "results.json").read_text())["memoria"]
        rows.append((label, result))
        calls = [json.loads(line) for line in (base / folder / "calls.jsonl").read_text().splitlines() if line.strip()]
        extraction = [c for c in calls if c["max_tokens"] in (900, 4096)]
        routing = [c for c in calls if c["max_tokens"] in (90, 1536)]
        audits[folder] = {"extraction_calls": len(extraction), "extraction_at_output_cap": sum(c["output_tokens"] >= c["max_tokens"] for c in extraction),
                         "router_calls": len(routing), "router_at_output_cap": sum(c["output_tokens"] >= c["max_tokens"] for c in routing)}
        if folder == "lfm3_adapted_dev":
            audits[folder]["extraction_reasoning_finished"] = sum(c["reasoning_finished"] for c in extraction)
    for label, result in rows:
        qa = result["qa"]["ext+router"]
        lines.append(f"| {label} | {qa['overall']['correct']}/45 ({qa['overall']['accuracy']:.1%}) | {qa['current']['correct']}/16 | {result['extraction']['recall']:.1%} | {result['router']['exact']}/45 | {result['cost']['extract_seconds_per_meeting']:.1f} |")
    lines += ["", "## Budget audit", "", "```json", json.dumps(audits, indent=2), "```", "",
              "The drop-in setup often generated reasoning despite enable_thinking=False and exhausted the 90-token routing or 900-token extraction budget. The adapted run enabled reasoning, used 4096 extraction / 1536 routing tokens, temperature 0.1, top-k 50 and repetition penalty 1.1; it scored final output only after a closing </think>. Unfinished reasoning was rejected rather than parsed as facts.", "",
              "The larger budget did not make this a useful Memoria configuration. These findings do not establish that LFM3 is intrinsically worse at every task: they apply to this OptiQ checkpoint/runtime, Memoria's prompts, and the two tested decoding setups. The simple smoke test passed, but long extraction performance and budget behaviour did not transfer. The adapted configuration was chosen after inspecting the failed dev run and is exploratory.", "",
              "Recommendation: keep Qwen for the present Memoria extractor/router and demo flow. A different LFM3 prompt, constrained generation or forced reasoning budget would be a further experiment, not evidence that the measured runs succeeded. Timings are recorded model-call generation times from different sessions, not a simultaneous hardware speed benchmark. No production default was changed."]
    save(base / "lfm3_comparison.json", audits)
    (base / "LFM3_COMPARISON.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
