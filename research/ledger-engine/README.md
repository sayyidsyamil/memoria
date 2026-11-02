# Memoria decision ledger engine

> **Location (2 November 2026).** Moved from `~/Desktop/FYP/engine` into the Memoria
> repository. `memoria_engine/` here links to `src-tauri/resources/memory/memoria_engine`
> (identical when moved), so run the commands below from `research/ledger-engine` rather
> than `engine`. Raw AMI audio and annotations are not in git; see [`../README.md`](../README.md).
> The desktop app this README calls `../app` is preserved on the `fyp2` branch (tag `v0.1.0-uat`).

The AI core of Memoria, a local-first meeting-memory app (final-year project, Universiti Malaya, WIA3003). It turns meeting transcripts into a **source-grounded ledger of decisions and commitments**:

- every recorded fact carries the **verbatim quote**, the speaker and the meeting it came from ("no evidence, no memory");
- the ledger keeps the **history** of each fact: what it was, what replaced it, when it took effect and when the system learned it (bitemporal);
- a belief-changing suggestion waits in a **review inbox** until a person accepts, edits or rejects it;
- questions are answered **from the ledger**, not by re-reading transcripts: current value, value on a past date, value as known on a past date, number of changes.

Everything runs on the user's computer. The language model is Qwen3.5-4B (4-bit) through MLX; the ledger itself is plain SQLite and uses only the Python standard library.

## Quick start

Requirements: a Mac with Apple silicon, Python 3.11. The ledger, the pipeline and the unit tests need no extra packages; the language model needs the packages in `requirements.txt`.

```bash
cd engine
python3.11 -m pip install -r requirements.txt          # only for the language model and the evaluation scripts
python3.11 -m unittest discover -s tests                # all unit, integration and error-handling tests (no model needed)
python3.11 -m memoria_engine.demo                       # a decision that changes over three meetings, with its audit trail
python3.11 -m memoria_engine.service --home /tmp/memoria-home --extractor none   # the JSON-lines service the desktop app uses
```

The first run with `--extractor mlx` downloads the model (about 2.5 GB) from Hugging Face.

## How it works

```
transcript turns ─▶ extractor (LLM, one window at a time) ─▶ candidates
                                                              │ quote must be found in a turn (exact, or at least 80% token overlap)
                                                              │ object and attribute must be tracked; value must fit its type
                                                              ▼
                                         policy: apply now, or put in the review inbox (belief-changing conflicts)
                                                              ▼
                      append-only ledger (SQLite + JSONL event log; the database can be rebuilt from the log)
                                                              ▼
 plain-English question ─▶ router (LLM) ─▶ lookup: current | as of a date | as known on a date | number of changes ─▶ answer + evidence
```

| File | What it does |
|---|---|
| `memoria_engine/ledger.py` | bitemporal ledger: facts, evidence, entities, proposals, reviews, corrections, retractions, invariants check, log replay |
| `memoria_engine/envelope.py` | which claim is in force at a given valid time (a late import of an older meeting cannot override a newer decision) |
| `memoria_engine/pipeline.py` | tracked-item registry, grounding of quotes, validation, review policy, ingestion of a meeting |
| `memoria_engine/extractors.py` | the prompt, the local model wrapper, a keyword baseline and an oracle (for tests) |
| `memoria_engine/windowed.py` | long meetings: overlapping windows, candidates merged |
| `memoria_engine/service.py` | JSON-lines service used by the desktop app (`ping`, `registry.*`, `meetings.*`, `facts.*`, `query`, `ask`, `proposals.*`, `brief`, `check`) |
| `memoria_engine/llmcache.py` | records every model call so long evaluations are resumable and auditable |
| `memoria_engine/evaluation/` | dataset format, router, metrics (Wilson intervals, bootstrap, exact sign test), baselines (full-context with chain of thought, BM25 retrieval), scaling experiment |

## Tests and evidence

```bash
python3.11 -m unittest discover -s tests           # run everything
python3.11 scripts/run_test_report.py              # test-case table, coverage and summary into results/testing/
```

`results/testing/` holds the test-case table (ID, requirement, input, expected, actual, result), the defect log and the coverage summary used in the project report.

## Evaluation (reproduce)

| What | Data | Command | Output |
|---|---|---|---|
| Real meetings (AMI, CC BY 4.0) | 7 scenario teams, 141 questions; dev = ES2003, TS3004; test = ES2004, ES2014, IS1009, TS3003, TS3007 | `bash scripts/ami/run_all.sh` (see `scripts/ami/run_rest.sh` for the sequenced version) | `results/ami/*.json`, tables with `scripts/ami/render_ami.py` |
| Synthetic stress chains (series length K) | `data/pilot_v0` | see `memoria_engine/evaluation/run_scaling.py` | `results/test/scaling_report.txt` |
| Fictional demo series (3 meetings, invented people) | `data/demo` | `python3.11 scripts/demo/system_test.py` | `results/demo/system_test.md` |
| Speech recognition and speaker separation | AMI audio and the demo audio | `scripts/asr_der_eval.py` | `results/asr/` |

Discipline: baselines are chosen on the dev split before the test split is touched; the hash of code and data is logged before the test run (`results/ami/frozen_manifest.sha256`, `logs/ami_run.log`); every model call is cached with its prompt hash, so a finished run can be audited and replayed.

`scripts/demo/make_demo.py` and `make_audio.py` regenerate the fictional series, its gold answers and a text-to-speech version of it.

## Honest limits

- The gold events for the AMI series were derived from the human abstracts by an AI assistant and cross-checked by an oracle run. Gold lists only the decisions the annotators wrote down, so extraction **precision is a lower bound**.
- Real meetings rarely reverse a decision: the AMI test split has only four real value changes. Claims about supersession rest mostly on the synthetic chains and the fictional series, which were also written with AI help.
- A 4B local model reads a few thousand tokens reliably; long meetings are split into windows. It tends to read tentative suggestions as decisions, which is why belief-changing conflicts go to the review inbox.
- The numbers measure this model on this data on one machine (Apple M5, 16 GB). They are not a claim about other models or other meetings.

## Licence and data

Engine code: original work for this project. The desktop app that uses it is an AGPL-3.0 fork of Tolaria (see `../app/NOTICE.md`). AMI Meeting Corpus: CC BY 4.0. The demo series contains no real people, companies or figures.
