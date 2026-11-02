# Hybrid transcript RAG and sensitivity analysis

This is an additional baseline, not a change to the evaluated ledger engine.
It uses **actual pretrained BGE-small embeddings + BM25**, weighted reciprocal-rank
fusion (RRF), chronological passage presentation, and actual local Qwen3.5-4B
generation. The v3 prompt, registry information, decoding and answer parser are
shared with the original baselines. It does not retrieve the gold decisions.

## Sensitivity model

The centre is top-k 12, 3 transcript lines per chunk, dense weight 0.5, RRF
constant 60, and 50 candidates from each ranker. Fixed one-factor-at-a-time
variants are k = 4/8/24, chunk lines = 1/6, dense weight = 0/.25/.75/1, and RRF
constant = 10/100. Weight zero and one are lexical-only and dense-only ablations.
Chunking is explicitly line-based to match the existing BM25 baseline, not token-based.
The encoder truncates each chunk to 512 model tokens; particularly long turns can
therefore be partially embedded even though the generator receives the full chunk.

For each factor the report computes the **change in accuracy** from the centre,
and the finite-difference slope (percentage points per parameter unit). This is a
local sensitivity model, not a fitted predictor; it cannot estimate interactions.
Each condition also records accuracy by question type, Wilson intervals,
generation latency, prompt size, and coverage of annotated evidence. Paired
comparisons resample entire teams; with only five test teams intervals are unstable.

Dev selection is fixed in advance: highest pooled exact-match accuracy at level
zero, then lowest mean prompt tokens, then configuration name. Test preparation
requires a complete development selection; do not select a new winner on test.
The earlier AMI test results have already been read, so this is an **exploratory
extension**, not a new untouched confirmatory experiment.

## Run (from engine/; one model job at a time)

Dependencies beyond the engine's requirements: `torch`, `transformers` (available
on the development machine). The encoder defaults to local cached weights; pass
`--allow-download` to prepare if intentionally downloading BGE-small.

```bash
python3.11 -m unittest discover -s tests
python3.11 -m scripts.hybrid_experiment prepare --split dev --out results/hybrid/dev_v2
python3.11 -m scripts.hybrid_experiment run --out results/hybrid/dev_v2
python3.11 -m scripts.hybrid_experiment report --out results/hybrid/dev_v2 --select --memoria results/ami/memoria_dev.json
python3.11 -m scripts.hybrid_experiment prepare --split test --selection results/hybrid/dev_v2/selection.json --out results/hybrid/test
python3.11 -m scripts.hybrid_experiment run --out results/hybrid/test
python3.11 -m scripts.hybrid_experiment report --out results/hybrid/test --memoria results/ami/memoria_test.json
```

Preparation freezes code/data hashes and fully rendered prompts before generation.
It exits before the MLX model loads, avoiding concurrent embedding/GPU memory use.
Every generated answer is checkpointed; rerun `run` to resume. `run --limit 10`
is a smoke run and is explicitly incomplete; a partial run cannot select settings.
Use a new output directory after changing frozen code or data. Existing report,
benchmark, caches and release files are not overwritten.

Generation latency is the cached original generator call, **not end-to-end live
RAG latency**. Preparation includes index building and embedding; retrieval traces
are retained in `cases.json`. No speed-superiority claim should use these times.
Compare identical questions and report current/as-of/change-count separately:
AMI's as-of questions all answer none, and gold evidence is incomplete.

Optional history-length sensitivity uses the separate synthetic chains:

```bash
python3.11 -m scripts.hybrid_experiment prepare --dataset synthetic --data data/pilot_v0 --split dev --levels 0,8,24,48 --out results/hybrid/synthetic_dev
```

This expands to 12 retrieval settings x 4 lengths. It is an optional additional
experiment, not part of the AMI run, and its padding is template-written distractors.

## Completed runs

`results/hybrid/COMPARISON.md` consolidates the completed 540-answer development
sweep and two 96-answer test comparisons. The primary dev winner was the dense-only
control. To keep an actual mixed hybrid contrast, a separately labelled secondary
selection restricts the same dev ranking to `0 < alpha < 1`:

```bash
python3.11 -m scripts.select_mixed_hybrid --out results/hybrid/dev_v2
python3.11 -m scripts.hybrid_experiment prepare --split test --selection results/hybrid/dev_v2/selection_mixed.json --out results/hybrid/test_mixed
python3.11 -m scripts.hybrid_experiment run --out results/hybrid/test_mixed
python3.11 -m scripts.hybrid_experiment report --out results/hybrid/test_mixed --memoria results/ami/memoria_test.json
python3.11 -m scripts.compare_hybrid
```

The consolidation script independently reparses all 192 raw RAG answers, checks
identical question/gold pairing, and writes the combined per-type comparison.
Results are exploratory, including the dev-selected secondary mixed contrast.
