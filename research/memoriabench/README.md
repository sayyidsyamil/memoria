# MemoriaBench and the live auditor

Research files from the historical live companion (`Memoria.app` v0.2, retired on
2 November 2026; the full app is in the backup archive). They measure whether a spoken
statement conflicts with the meeting decisions a person has approved.

| Files | Purpose |
|---|---|
| `memoria.py`, `guard.py`, `decisions.md` | The auditor (`check_statement`, Qwen3.5-4B 4-bit) and the guard that confirms an alert before it is shown |
| `generate_bench.py`, `validate_bench.py`, `ami_loader.py`, `data/` | MemoriaBench: 336 statements from 28 AMI series in six classes, generated without a language model and frozen by SHA-256 |
| `run_benchmarks.py`, `eval_metrics.py`, `stat_tests.py`, `export_thesis_tables.py` | Systems B0, B1, B1b, B2, M2 and A1; metrics, significance tests, thesis tables |
| `scoping.py`, `run_scoping.py`, `scoping_report.py`, `scoping_posthoc.py`, `retriever_bakeoff.py`, `bakeoff_malay.py`, `embed_texts.py`, `latency_paired.py` | Pre-registered topic-scoping study and retriever comparisons |
| `make_ch6_draft.py`, `results/chapter6_memoriabench_draft.md` | Draft report section, generated from the result files |
| `results/` | Predictions, cached model calls, statistics and tables; `memoria_as_run.py` is the auditor exactly as run |
| `GUARD.md` | Guard design and its measurements on real speech |
| `app_live_check_bench.py`, `APP_LIVE_CHECK.md` | The app's own live check on the same probes (roadmap M2) |
| `test_*.py` | Self-checking scripts: run each with `python3.11 test_name.py` |

## Results

Test split, warm runs on an Apple M5 with 16 GB, 15 October 2026
(`results/chapter_6_table_1.md`):

| System | Macro-F1 [95% CI] | Alert recall | False alarms |
|---|---|--:|--:|
| M2 full Memoria | **0.87** [0.84, 0.90] | 0.98 | 0.4% |
| A1 M2 without supersession notes | 0.74 [0.71, 0.77] | 0.88 | 0.4% |
| B2 transcript RAG | 0.62 [0.57, 0.66] | 0.53 | 1.8% |
| B0 closed book | 0.42 [0.38, 0.46] | 0.12 | 6.2% |
| B1 embedding similarity | 0.16 [0.15, 0.16] | 0.94 | 33.9% |

On real speech, the guard cut false alerts from 15.7% to 0.21% of sentences, while catching
107 of the benchmark's 112 conflicts instead of 110 (`GUARD.md`).

## Reproduce

```sh
python3.11 validate_bench.py                 # checks the frozen dataset, no model
python3.11 run_benchmarks.py --split test    # model run: quit Memoria first (one model at a time on 16 GB)
python3.11 export_thesis_tables.py
python3.11 make_ch6_draft.py
```

`make_ch6_draft.py --report` copies the draft to the report's old folder,
`~/Desktop/FYP/report/ap2`; the report is now kept privately, outside this repository.

## Caveats

- MemoriaBench is reported as an extension, not an objective: the report's objectives concern
  the ledger (decided on 2 November, to be confirmed with the supervisor).
- Statements are template-generated clean text, not speech-recognition output; labels were
  audited by language models; memory is the annotators' decisions. Cite the series-level
  tests. The draft's limitations section lists the rest.
- The current app's live check (`src-tauri/resources/memory/live_assistance.py`) is a different
  implementation, and these scores do not transfer to it. It is scored on the same test split in
  `APP_LIVE_CHECK.md` (the check of 2 November) and
  [`../live-verifier/README.md`](../live-verifier/README.md) (the check of `v0.3.0-uat`: 98 of 112
  conflicts caught, 2 false alarms in 224).
