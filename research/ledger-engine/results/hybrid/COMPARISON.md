# Memoria versus actual hybrid RAG

All new RAG scores were recomputed from raw generated answers; exactly the same 96 questions and gold answers are paired with the stored ledger run.

| System | Overall (96) | Current (34) | Past-date (29) | Changes (33) |
|---|---:|---:|---:|---:|
| Memoria ledger (stored run) | 59/96 (61.5%) | 18/34 (52.9%) | 29/29 (100.0%) | 12/33 (36.4%) |
| Full-context + CoT (stored run) | 41/96 (42.7%) | 24/34 (70.6%) | 6/29 (20.7%) | 11/33 (33.3%) |
| BM25 RAG (stored run) | 37/96 (38.5%) | 22/34 (64.7%) | 14/29 (48.3%) | 1/33 (3.0%) |
| Hybrid RAG (75% dense, 25% BM25) | 39/96 (40.6%) | 22/34 (64.7%) | 15/29 (51.7%) | 2/33 (6.1%) |
| Dense-only RAG | 43/96 (44.8%) | 24/34 (70.6%) | 16/29 (55.2%) | 3/33 (9.1%) |

## Finding

The ledger is ahead overall: +20.8 percentage points over the mixed hybrid and +16.7 over dense-only RAG. The ledger is behind on current-value questions (52.9% versus 64.7% hybrid and 70.6% dense). It gains on past-date questions and change counts. All AMI past-date answers are none, so the 100% ledger result tests leakage prevention, not general retrieval of superseded values.

The hybrid improves the old BM25 baseline by only 2/96 answers; dense-only by 6/96. These small differences do not establish superiority. The mixed configuration was selected on development answers only, as a secondary exploratory comparison after a dense-only control won the primary rule's tie-break.

## Actual RAG pipeline

Raw speaker-labelled transcript chunks → BGE-small CLS semantic embeddings and BM25 → weighted reciprocal-rank fusion → top 12 passages in meeting order → Qwen3.5-4B 4-bit → existing answer parser. The mixed winner uses three-line chunks, 75% dense weight and RRF constant 60. No gold event or answer is supplied to retrieval or generation.

The new RAG uses the existing direct-answer budget (24 output tokens). Full-context uses the earlier CoT budget (4096). Thus the stored full-context comparison is a system comparison, not a pure retrieval ablation. CoT, reranking, query expansion, token-based overlapping chunks, other embedders and larger models were not evaluated in this run; do not describe the baseline as the strongest possible hybrid RAG.

## Measured sensitivity model (development split)

540 generations = 45 questions × 12 fixed OAT configurations. The centre scored 26.7%. One factor changes at a time; the reported slopes are descriptive local finite differences, not causal estimates, fitted predictions, or interaction estimates.

| Factor | Tested values | Development accuracy range |
|---|---|---:|
| Top-k | 4, 8, 12, 24 | 26.7–31.1% |
| Chunk lines | 1, 3, 6 | 26.7–33.3% |
| Dense weight | 0, .25, .5, .75, 1 | 26.7–33.3% |
| RRF constant | 10, 60, 100 | 24.4–26.7% |

Increasing retrieval volume did not monotonically improve accuracy. Top-24 retrieved more annotated evidence (25/46 versus 18/46 at the centre), but answered only one additional question correctly (13 versus 12). Retrieval coverage alone is not sufficient for correct temporal reasoning. With only 45 questions from two teams, one answer changes accuracy by 2.22 points; these are coarse sensitivity estimates.

History-length sensitivity is implemented as an optional synthetic-padding sweep but was not run here. This completed analysis measures retrieval hyperparameter sensitivity only.

## Limits and outputs

This is an exploratory extension: the previous AMI test results had already been inspected. Only five test teams; the paired team-bootstrap intervals in comparison.json are unstable at this sample size. Gold events are AI-assisted and incomplete. The ledger was not regenerated; its recorded evaluated answers are reused. Generation timings exclude offline indexing/embedding and must not be presented as live end-to-end RAG latency.

- `dev_v2/report.md`: full sensitivity table and local slopes.
- `test_mixed/report.md`: actual hybrid evaluation.
- `test/report.md`: development-selected dense-only control.
- `comparison.json`: per-type scores and paired cluster-bootstrap differences.
- Each run: frozen plan, prompt/retrieval traces, raw answers, and resumable generation cache.
- Reproduction: `engine/HYBRID_RAG.md`.
