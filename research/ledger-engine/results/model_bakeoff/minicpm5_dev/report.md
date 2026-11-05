# Candidate model screening on Memoria

Candidate: openbmb/MiniCPM5-2B-MLX at `8a9ad7539ac86281d0ac2b017ba04a5de53fe9a3`.

Identical AMI development teams ES2003/TS3004, 8 meetings, 45 questions, same extraction windows, prompts, pipeline and router.

| Measure | Candidate | Qwen reference |
|---|---:|---:|
| QA overall | 24/45 (53.3%) | 35/45 (77.8%) |
| QA current | 0/16 (0.0%) | 12/16 (75.0%) |
| QA as_of_valid | 13/13 (100.0%) | 13/13 (100.0%) |
| QA n_changes | 11/16 (68.8%) | 10/16 (62.5%) |
| Extraction precision | undefined (no scored predictions) | 20.5% |
| Extraction recall | 0.0% | 65.2% |
| Extraction f1 | undefined (no scored predictions) | 31.2% |

**Eligible for held-out follow-up:** False. **Default changed:** no.

- overall_qa_strictly_better: False
- current_qa_not_worse: False
- extraction_precision_not_worse: False
- extraction_recall_not_worse: False

This is development screening, not proof of superiority. Qwen's reference is a stored prior run; timing is not paired or simultaneous. Each model uses its own chat template with thinking disabled and the same output budgets. No prompt tuning or test-set selection was done. Extraction precision is a lower bound against incomplete AMI annotations.

Live HUD guard thresholds are calibrated to Qwen and are not validated by this ledger experiment. A replacement there also needs alert/false-alarm/citation tests and guard recalibration. The released application and its default remain the evaluated Qwen version.
