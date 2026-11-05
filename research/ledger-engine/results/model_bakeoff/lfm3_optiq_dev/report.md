# Candidate model screening on Memoria

Candidate: mlx-community/LFM3-1.7B-OptiQ-4bit at `82d0e45972a9343db2ab5534b257b2d6fb3edd46`.

Identical AMI development teams ES2003/TS3004, 8 meetings, 45 questions, same extraction windows, prompts, pipeline and router.

| Measure | Candidate | Qwen reference |
|---|---:|---:|
| QA overall | 2/45 (4.4%) | 35/45 (77.8%) |
| QA current | 1/16 (6.2%) | 12/16 (75.0%) |
| QA as_of_valid | 0/13 (0.0%) | 13/13 (100.0%) |
| QA n_changes | 1/16 (6.2%) | 10/16 (62.5%) |
| Extraction precision | 16.7% | 20.5% |
| Extraction recall | 8.7% | 65.2% |
| Extraction f1 | 11.4% | 31.2% |

**Eligible for held-out follow-up:** False. **Default changed:** no.

- overall_qa_strictly_better: False
- current_qa_not_worse: False
- extraction_precision_not_worse: False
- extraction_recall_not_worse: False

This is development screening, not proof of superiority. Qwen's reference is a stored prior run; timing is not paired or simultaneous. Each model uses its own chat template with thinking disabled and the same output budgets. No prompt tuning or test-set selection was done. Extraction precision is a lower bound against incomplete AMI annotations.

Live HUD guard thresholds are calibrated to Qwen and are not validated by this ledger experiment. A replacement there also needs alert/false-alarm/citation tests and guard recalibration. The released application and its default remain the evaluated Qwen version.
