**Results on MemoriaBench (336 probes in 28 AMI test series)**

| System | Acc. (%) | Macro-F1 | Alert prec. | Alert rec. | False alarm (%) | P50 (ms) | P95 (ms) | Mem. (GB) |
|:--|--:|--:|--:|--:|--:|--:|--:|--:|
| B0 Closed book | 47.9 | 0.42 [0.38, 0.46] | 0.48 | 0.12 | 6.2 | 1,059 | 1,381 | 3.5 |
| B1 Embeddings, alert if similarity ≥ τ | 31.5 | 0.16 [0.15, 0.16] | 0.58 | 0.94 | 33.9 | **4** | **5** | **0.4** |
| B1b Embeddings, three bands | 37.2 | 0.25 [0.22, 0.28] | 0.66 | 0.90 | 23.7 | **4** | **5** | **0.4** |
| B2 Transcript RAG | 61.6 | 0.62 [0.57, 0.66] | 0.94 | 0.53 | 1.8 | 2,391 | 2,988 | 3.5 |
| M2 Full Memoria (proposed) | **87.2** | **0.87** [0.84, 0.90] | **0.99** | **0.98** | **0.4** | 2,274 | 3,620 | 3.5 |
| A1 M2 without supersession notes | 78.6 | 0.74 [0.71, 0.77] | **0.99** | 0.88 | **0.4** | 2,554 | 3,738 | 3.7 |

Bold marks the best value in a column (ties are all marked). An alert is a predicted OUTDATED or CONTRADICTS; a false alarm is an alert on a probe that is not one. P50 and P95 are warm, per probe, on an Apple M5 with 16 GB; memory is the peak physical footprint of the process. M2 and A1 read the annotators' decisions, B2 the raw transcript. Brackets: 95% cluster-bootstrap interval, resampling the 28 series.
