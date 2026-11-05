# LFM3 versus Qwen: completed development experiments

Same 8 AMI development meetings and 45 questions. Qwen uses the stored prior evaluated run.

| Configuration | QA | Current | Extraction recall | Router exact | Extraction s/meeting |
|---|---:|---:|---:|---:|---:|
| Qwen reference | 35/45 (77.8%) | 12/16 | 65.2% | 39/45 | 61.4 |
| LFM3 drop-in, thinking requested off | 2/45 (4.4%) | 1/16 | 8.7% | 3/45 | 61.3 |
| LFM3 reasoning, larger budget | 7/45 (15.6%) | 0/16 | 0.0% | 20/45 | 276.1 |

## Budget audit

```json
{
  "lfm3_optiq_dev": {
    "extraction_calls": 41,
    "extraction_at_output_cap": 40,
    "router_calls": 45,
    "router_at_output_cap": 40
  },
  "lfm3_adapted_dev": {
    "extraction_calls": 41,
    "extraction_at_output_cap": 31,
    "router_calls": 45,
    "router_at_output_cap": 21,
    "extraction_reasoning_finished": 0
  }
}
```

The drop-in setup often generated reasoning despite enable_thinking=False and exhausted the 90-token routing or 900-token extraction budget. The adapted run enabled reasoning, used 4096 extraction / 1536 routing tokens, temperature 0.1, top-k 50 and repetition penalty 1.1; it scored final output only after a closing </think>. Unfinished reasoning was rejected rather than parsed as facts.

The larger budget did not make this a useful Memoria configuration. These findings do not establish that LFM3 is intrinsically worse at every task: they apply to this OptiQ checkpoint/runtime, Memoria's prompts, and the two tested decoding setups. The simple smoke test passed, but long extraction performance and budget behaviour did not transfer. The adapted configuration was chosen after inspecting the failed dev run and is exploratory.

Recommendation: keep Qwen for the present Memoria extractor/router and demo flow. A different LFM3 prompt, constrained generation or forced reasoning budget would be a further experiment, not evidence that the measured runs succeeded. Timings are recorded model-call generation times from different sessions, not a simultaneous hardware speed benchmark. No production default was changed.
