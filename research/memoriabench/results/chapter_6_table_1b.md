**Results on the official AMI unseen subset (60 probes in 5 series: ES2004, ES2014, IS1009, TS3003, TS3007)**

| System | Acc. (%) | Macro-F1 | Alert prec. | Alert rec. | False alarm (%) | P50 (ms) | P95 (ms) | Mem. (GB) |
|:--|--:|--:|--:|--:|--:|--:|--:|--:|
| B0 Closed book | 50.0 | 0.45 | 0.71 | 0.25 | 5.0 | 1,071 | 1,371 | 3.5 |
| B1 Embeddings, alert if similarity ≥ τ | 31.7 | 0.16 | 0.61 | 0.85 | 27.5 | **4** | **5** | **0.4** |
| B1b Embeddings, three bands | 31.7 | 0.18 | 0.62 | 0.80 | 25.0 | **4** | **5** | **0.4** |
| B2 Transcript RAG | 55.0 | 0.54 | 0.91 | 0.50 | 2.5 | 2,386 | 2,771 | 3.5 |
| M2 Full Memoria (proposed) | **85.0** | **0.85** | 0.95 | **1.00** | 2.5 | 1,860 | 3,234 | 3.5 |
| A1 M2 without supersession notes | 75.0 | 0.69 | **1.00** | 0.85 | **0.0** | 2,447 | 3,585 | 3.7 |

Bold marks the best value in a column (ties are all marked). An alert is a predicted OUTDATED or CONTRADICTS; a false alarm is an alert on a probe that is not one. P50 and P95 are warm, per probe, on an Apple M5 with 16 GB; memory is the peak physical footprint of the process. M2 and A1 read the annotators' decisions, B2 the raw transcript. Point estimates only: 5 series are too few for an interval.
