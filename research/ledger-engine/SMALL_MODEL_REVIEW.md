# Small model review for Memoria — 29 October 2026

## Decision

Keep the evaluated Qwen3.5-4B default. Add model screening as a development tool,
not an unconditional model replacement. MiniCPM5 was downloaded and tested locally:
it loads correctly but is not a suitable drop-in extractor with the current prompt.
No live ledger, app model, speech model, installed runtime, frozen study or report
chapter was changed by this experiment.

## Verified releases and integration fit

Facts below come from the linked publishers' model cards, configs and licences.
Publisher benchmark numbers are not Memoria results and are not directly comparable
across different harnesses, precisions and reasoning budgets.

| Model | Verified details | Fit for this Mac and Memoria |
|---|---|---|
| [LiquidAI LFM3-1.7B](https://huggingface.co/LiquidAI/LFM3-1.7B) | 1.73B, tri-hybrid convolution/sliding/global attention, 256K context; [official MLX pack](https://huggingface.co/LiquidAI/LFM3-1.7B-MLX-4bit) is 0.97 GB of weights | Promising for structured outputs and routing, but official card says mlx-lm support is **in progress**. Installed mlx-lm 0.31.3 has no lfm3 module. GGUF requires an LFM3-capable llama.cpp build. Thinking-off can be inconsistent according to its card. |
| [OpenBMB MiniCPM5-2B](https://huggingface.co/openbmb/MiniCPM5-2B) | Standard Llama architecture, 42 layers, 128K context; actually 2.517B total / 1.982B non-embedding parameters. Apache-2.0. Official 4-bit MLX weights are about 1.416 GB | Easiest integration; actually tested below. Its advertised agent/reasoning scores did not translate into useful extraction with Memoria's unchanged prompt. English/Chinese are the card's declared languages. |
| [Spark-X2.6-1.7B](https://huggingface.co/XHToken/Spark-X2.6-1.7B) | Apache-2.0; custom spark2_5 architecture; config advertises 1,048,576 positions; none/low/high reasoning controls | Official [Spark-MLX-LLM](https://github.com/XHToken/Spark-MLX-LLM) runtime, GGUF, llama.cpp support b10828+ per card. Not an ordinary Llama checkpoint for our pinned runtime. Million-token capacity is not a promise of feasible memory/latency on 16 GB. |
| [Bonsai 2 Ternary 4B](https://huggingface.co/prism-ml/Ternary-Bonsai-2-4B-mlx-2bit), [2B](https://huggingface.co/prism-ml/Ternary-Bonsai-2-2B-mlx-2bit) | Apache-2.0; Qwen3.5-derived, ternary weights plus Hadamard activation transforms. 4B MLX pack is 1.87 GB including vision tower, 262K context | A compression alternative to Qwen rather than an unrelated all-round model. Card requires mlx-vlm 0.7.8+ or bundled runtime; says released mlx-lm 0.32.0 cannot yet load it. Never treat as plain 2-bit Qwen without the matching transforms. |
| [NVIDIA Nemotron 3.5 Bolt E4B 4GB](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-4GB) | Gemma-4-E4B-derived; **8B total, 4B effective**, Q4_K_M GGUF; up to 64K context, reasoning and conversational modes; OpenMDW-1.1 | Interesting grounding/structured-output candidate. Official recipe uses llama.cpp; NVIDIA/CUDA recipe performance is not an Apple benchmark. Needs a separately verified Metal runtime rather than assuming it loads in the present MLX extractor. |

The LFM [Open License v1.0](https://huggingface.co/LiquidAI/LFM3-1.7B/blob/main/LICENSE)
is not Apache-2.0. It excludes commercial use by a legal entity above its $10M
annual-revenue threshold; research/non-commercial provisions differ. That matters
for a possible enterprise deployment. MiniCPM5,
Spark and Bonsai use Apache-2.0; Bolt states OpenMDW-1.1.

Small weight files do not equal small peak memory. KV cache, activations, audio,
diarization and the app share the same 16 GB. Context limits are capacity claims,
not guaranteed reliable temporal reasoning or measured usable Mac context.

## Actual local MiniCPM5 screen

Official checkpoint: `openbmb/MiniCPM5-2B-MLX`, pinned revision
`8a9ad7539ac86281d0ac2b017ba04a5de53fe9a3`. Native installed mlx-lm 0.31.3.
Same AMI development teams (ES2003, TS3004), 8 meetings / 45 questions,
7000-character extraction windows, prompts, output budgets, ledger and router.
Each model uses its own chat template with thinking disabled. Qwen's reference
is the stored earlier development run, not a simultaneous timing comparison.

| Measure | MiniCPM5 | Qwen3.5-4B reference |
|---|---:|---:|
| QA overall | 24/45 (53.3%) | 35/45 (77.8%) |
| Current values | 0/16 | 12/16 |
| Past-date | 13/13 | 13/13 |
| Change count | 11/16 | 10/16 |
| Extraction recall | 0% | 65.2% |
| Extraction precision | Undefined: no scored predictions | 20.5% (incomplete gold lower bound) |

The candidate left the ledger empty. Its apparently respectable 53.3% is explained
by none answers and zero-change answers, not useful memory. Raw extraction replies
mostly explicitly say `{"events":[]}`. In contrast its question router was exact
on **45/45**; it is worth considering as a router-only candidate in a separate
paired experiment, not yet as an extraction replacement. Peak MLX allocation in
this run was about 2.20 GB (not the whole app's footprint).

After seeing that failure, two tiny diagnostic prompts were run: it correctly
extracted an explicit English supplier decision, but returned no event for its
Malay counterpart. These are diagnostic examples, not a bilingual benchmark.
Results apply to this quantized checkpoint, unchanged prompt and thinking-off
configuration, not every possible MiniCPM5 setup. Prompt adaptation or reasoning
could help but would be a new development experiment, not a reinterpretation of
this failed drop-in screen.

## Update path now available

```bash
# From engine/. Cached weights only by default; --allow-download intentionally fetches.
python3.11 -m scripts.model_bakeoff run --model minicpm5 --allow-download
python3.11 -m scripts.model_bakeoff report
python3.11 -m scripts.model_smoke
python3.11 -m unittest discover -s tests
```

`scripts/model_bakeoff.py` records the checkpoint revision, code/data hashes,
call cache, extraction results, per-type QA, router quality and memory. It applies
a dev screening gate: improve pooled QA without regressing current-value QA,
extraction precision or recall. A passing candidate still needs a held-out run
and application regression; there is no automatic production switch.

The engine service already supports `--model`; no new global model environment
variable was needed. Evaluation and live app are kept distinct. The independent
HUD's guard uses logit thresholds calibrated to Qwen: a replacement there needs
separate false-alert, citation and confirmation-threshold evaluation.

Outputs: `results/model_bakeoff/minicpm5_dev/{plan.json,results.json,calls.jsonl,report.md,diagnostic.json}`.
The plan preserves the original run's code hashes. A report-only fix to display
undefined precision/F1 was made after generation; the original plan was retained.
Re-running generation after that script edit requires a fresh output directory.

## Next candidates

1. LFM3 through OptiQ >= 0.7.8 in an isolated runtime (see correction below).
2. Bonsai 2 4B if reducing Qwen's memory footprint is the goal, using its correct loader.
3. Bolt for grounding or Spark for a small agent, after the local backend is verified.

For every candidate measure Memoria's actual decisions, numbers, evidence quotes,
abstention, current/past/change queries and Malay/code-switching, not just public
math/coding leaderboards. Keep model comparison paired across ledger and RAG if
making a new claim about the architecture.

## Correction: LFM3 has an OptiQ-vendored MLX path

The [community OptiQ checkpoint card](https://huggingface.co/mlx-community/LFM3-1.7B-OptiQ-4bit)
documents `from optiq.models import install_vendored; install_vendored()` before
`mlx_lm.load`. Native mlx-lm support being absent does **not** make this model
unavailable on MLX. The [family guide](https://mlx-optiq.com/docs/lfm) and
[changelog](https://mlx-optiq.com/changelog) specify **mlx-optiq 0.7.8+**.

This checkpoint is 1.34 GB mixed precision, not uniform 4-bit: 75 of 153 weight
matrices remain 8-bit according to its card. Its reported 71.29 versus 67.70
six-metric mean compares two quants of LFM3, in reasoning mode; it is neither a
Memoria result nor evidence of superiority over our Qwen configuration. The
quantization sensitivity chooses per-layer bit widths; it is different from our
RAG retrieval-hyperparameter sensitivity analysis.

### Local verification and blocker

Created a separate environment outside the project at
`/var/folders/mq/y5_t7z2x7498pv2q3dmdg2x00000gn/T/opencode/lfm3-venv`.
The configured package mirror exposed only mlx-optiq 0.7.0. Installed it there
(mlx-lm 0.32.2, mlx 0.32.4); fixed an installation dependency conflict by pinning
huggingface-hub 1.15.0, and `pip check` then passed. Inspected its installed
`install_vendored`: it registers llada2, mistral4 and xing4_0, **not lfm3**.
Importing `mlx_lm.models.lfm3` after registration failed.

PyPI's version-specific metadata lists 0.7.8, uploaded 28 October 2026, but the
mirror cannot supply it and direct files.pythonhosted.org downloads time out.
**LFM3 inference and Memoria accuracy have not been measured.** No LFM3 weights
were downloaded. The global pinned Memoria environment is unchanged.

### Ready-to-run integration check

In a separate environment with the accessible supported release:

```bash
python -m pip install 'mlx-optiq==0.7.8' 'huggingface-hub<2'
python -m pip check
# From engine/:
python -m scripts.lfm3_bakeoff --preflight
python -m scripts.lfm3_bakeoff --allow-download
```

The runner pins checkpoint revision
`82d0e45972a9343db2ab5534b257b2d6fb3edd46`, checks the runtime, registers the
vendored implementation only in that process, and reuses the AMI development
screen. This first experiment is explicitly a **drop-in thinking-off screen**
with existing budgets, not a reproduction of OptiQ's reasoning-mode benchmarks
or its server-side mixed-precision KV configuration. A subsequent reasoning run
would need a larger separate budget, answer-only parsing and separately recorded
latency/settings. No production model switch is justified until task results exist.

## Blocker resolved: real LFM3 smoke test passed

An alternate PyPI mirror (`https://pypi.tuna.tsinghua.edu.cn/simple`) supplied
mlx-optiq 0.7.8 in the isolated environment. Its vendored LFM3 registration passed.
Downloaded the revision-pinned model and ran `python -m scripts.lfm3_smoke`.

The prompt asked for JSON containing only final decisions, with one tentative
Acme suggestion and one final Beta supplier decision. LFM3 returned valid JSON,
selected Beta, preserved the exact evidence quote and omitted the suggestion.
Generation took **1.82 seconds**; peak MLX allocation was **1.56 GB** for this
short check (not end-to-end app memory). Thinking was off, output budget 256,
temperature 0.1, top-k 50, repetition penalty 1.1. Transformers emitted rope
configuration warnings, but loading and generation completed.

Raw settings/output: `results/model_bakeoff/lfm3_smoke.json`.
This verifies actual local compatibility and one extraction example only; the AMI
development benchmark and live guard evaluation have not run. Qwen remains the
application default. Earlier blocker notes above are retained as setup history.

## Completed AMI development comparison

The full comparison has now run on both development teams (8 meetings / 45
questions), followed by an explicitly adapted reasoning run. See
`results/model_bakeoff/LFM3_COMPARISON.md` for raw-run locations and budget audit.

- Qwen reference: **35/45 (77.8%)**, current values 12/16, extraction recall 65.2%.
- LFM3 unchanged-budget drop-in: **2/45 (4.4%)**, current 1/16, recall 8.7%.
- LFM3 with reasoning and larger budgets: **7/45 (15.6%)**, current 0/16.

LFM3 frequently reasons despite the thinking-off request. In the adapted run,
31/41 extraction calls reached the 4096-token cap and no extraction reply exposed
a closing reasoning tag to the answer parser; reasoning-only replies were rejected.
Thus zero accepted extraction in that run is an integration/budget result, not a
general claim that LFM3 has no extraction capability. The larger-budget run took
276.1 generation seconds per meeting versus Qwen's stored 61.4 seconds (different
sessions). Neither tested LFM3 setup is better for the current Memoria flow.
