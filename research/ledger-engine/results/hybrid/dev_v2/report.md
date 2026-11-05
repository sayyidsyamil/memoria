# Hybrid RAG comparison and sensitivity

Split: dev; complete: True; 540/540 answers.

Dense BGE + BM25, weighted reciprocal-rank fusion, actual Qwen generation; same v3 prompt and parser as the baseline.

| Padding | Configuration | Correct / n | Accuracy | Median generation s | Mean prompt tokens | Annotated evidence found / total |
|---|---|---:|---:|---:|---:|---:|
| 0 | hybrid-k12-w3-a0.5-r60-c50 | 12/45 | 26.7% | 3.36 | 2913 | 18/46 |
| 0 | hybrid-k4-w3-a0.5-r60-c50 | 14/45 | 31.1% | 1.85 | 1352 | 11/46 |
| 0 | hybrid-k8-w3-a0.5-r60-c50 | 13/45 | 28.9% | 3.57 | 2132 | 17/46 |
| 0 | hybrid-k24-w3-a0.5-r60-c50 | 13/45 | 28.9% | 9.25 | 4903 | 25/46 |
| 0 | hybrid-k12-w1-a0.5-r60-c50 | 14/45 | 31.1% | 2.94 | 1833 | 13/46 |
| 0 | hybrid-k12-w6-a0.5-r60-c50 | 15/45 | 33.3% | 9.72 | 4293 | 18/46 |
| 0 | hybrid-k12-w3-a0-r60-c50 | 13/45 | 28.9% | 7.71 | 2936 | 12/46 |
| 0 | hybrid-k12-w3-a0.25-r60-c50 | 14/45 | 31.1% | 6.13 | 3025 | 17/46 |
| 0 | hybrid-k12-w3-a0.75-r60-c50 | 15/45 | 33.3% | 4.06 | 2723 | 20/46 |
| 0 | hybrid-k12-w3-a1-r60-c50 | 15/45 | 33.3% | 3.18 | 2264 | 19/46 |
| 0 | hybrid-k12-w3-a0.5-r10-c50 | 11/45 | 24.4% | 3.78 | 2768 | 17/46 |
| 0 | hybrid-k12-w3-a0.5-r100-c50 | 12/45 | 26.7% | 3.57 | 2915 | 18/46 |

## Local sensitivity model

One factor at a time; differences from the centre configuration. Finite-difference slopes are descriptive, not a predictive model or interaction estimate.

| Padding | Parameter | Value | Delta accuracy (percentage points) | pp per parameter unit |
|---|---|---:|---:|---:|
| 0 | k | 4 | +4.44 | -0.556 |
| 0 | k | 8 | +2.22 | -0.556 |
| 0 | k | 24 | +2.22 | +0.185 |
| 0 | window | 1 | +4.44 | -2.222 |
| 0 | window | 6 | +6.67 | +2.222 |
| 0 | alpha | 0.0 | +2.22 | -4.444 |
| 0 | alpha | 0.25 | +4.44 | -17.778 |
| 0 | alpha | 0.75 | +6.67 | +26.667 |
| 0 | alpha | 1.0 | +6.67 | +13.333 |
| 0 | rrf | 10 | -2.22 | +0.044 |
| 0 | rrf | 100 | +0.00 | +0.000 |

**hybrid-k12-w3-a0.5-r60-c50 minus Memoria:** -51.11 pp; series-bootstrap interval [-56.00, -45.00] pp (2 teams).

**hybrid-k4-w3-a0.5-r60-c50 minus Memoria:** -46.67 pp; series-bootstrap interval [-50.00, -44.00] pp (2 teams).

**hybrid-k8-w3-a0.5-r60-c50 minus Memoria:** -48.89 pp; series-bootstrap interval [-52.00, -45.00] pp (2 teams).

**hybrid-k24-w3-a0.5-r60-c50 minus Memoria:** -48.89 pp; series-bootstrap interval [-50.00, -48.00] pp (2 teams).

**hybrid-k12-w1-a0.5-r60-c50 minus Memoria:** -46.67 pp; series-bootstrap interval [-52.00, -40.00] pp (2 teams).

**hybrid-k12-w6-a0.5-r60-c50 minus Memoria:** -44.44 pp; series-bootstrap interval [-48.00, -40.00] pp (2 teams).

**hybrid-k12-w3-a0-r60-c50 minus Memoria:** -48.89 pp; series-bootstrap interval [-52.00, -45.00] pp (2 teams).

**hybrid-k12-w3-a0.25-r60-c50 minus Memoria:** -46.67 pp; series-bootstrap interval [-56.00, -35.00] pp (2 teams).

**hybrid-k12-w3-a0.75-r60-c50 minus Memoria:** -44.44 pp; series-bootstrap interval [-48.00, -40.00] pp (2 teams).

**hybrid-k12-w3-a1-r60-c50 minus Memoria:** -44.44 pp; series-bootstrap interval [-56.00, -30.00] pp (2 teams).

**hybrid-k12-w3-a0.5-r10-c50 minus Memoria:** -53.33 pp; series-bootstrap interval [-60.00, -45.00] pp (2 teams).

**hybrid-k12-w3-a0.5-r100-c50 minus Memoria:** -51.11 pp; series-bootstrap interval [-56.00, -45.00] pp (2 teams).

## Interpretation limits

- Dev results tune the baseline; they are not held-out findings. Test results are an exploratory extension because the earlier test set was already inspected.
- Only two dev and five test teams: confidence intervals and question-level p-values need caution; questions within a team are dependent.
- Generation times come from cached original calls. Offline preparation/indexing/embedding time is excluded; these are not end-to-end live RAG latencies.
- Evidence coverage is a diagnostic on incomplete gold events, not answer correctness; no eligible evidence is not a retrieval failure.
- The OAT design cannot estimate interactions. Padding, if requested on synthetic chains, measures template distractors rather than additional real meetings.
- Report per-question-type accuracy from summary.json: pooled accuracy can hide the easy all-none AMI past-date questions.
