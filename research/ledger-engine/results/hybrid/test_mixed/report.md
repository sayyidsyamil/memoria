# Hybrid RAG comparison and sensitivity

Split: test; complete: True; 96/96 answers.

Dense BGE + BM25, weighted reciprocal-rank fusion, actual Qwen generation; same v3 prompt and parser as the baseline.

| Padding | Configuration | Correct / n | Accuracy | Median generation s | Mean prompt tokens | Annotated evidence found / total |
|---|---|---:|---:|---:|---:|---:|
| 0 | hybrid-k12-w3-a0.75-r60-c50 | 39/96 | 40.6% | 3.45 | 2736 | 26/91 |

## Local sensitivity model

One factor at a time; differences from the centre configuration. Finite-difference slopes are descriptive, not a predictive model or interaction estimate.

| Padding | Parameter | Value | Delta accuracy (percentage points) | pp per parameter unit |
|---|---|---:|---:|---:|

**hybrid-k12-w3-a0.75-r60-c50 minus Memoria:** -20.83 pp; series-bootstrap interval [-29.00, -11.96] pp (5 teams).

## Interpretation limits

- Dev results tune the baseline; they are not held-out findings. Test results are an exploratory extension because the earlier test set was already inspected.
- Only two dev and five test teams: confidence intervals and question-level p-values need caution; questions within a team are dependent.
- Generation times come from cached original calls. Offline preparation/indexing/embedding time is excluded; these are not end-to-end live RAG latencies.
- Evidence coverage is a diagnostic on incomplete gold events, not answer correctness; no eligible evidence is not a retrieval failure.
- The OAT design cannot estimate interactions. Padding, if requested on synthetic chains, measures template distractors rather than additional real meetings.
- Report per-question-type accuracy from summary.json: pooled accuracy can hide the easy all-none AMI past-date questions.
