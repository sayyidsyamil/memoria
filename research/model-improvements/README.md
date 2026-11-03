# Model improvements: extraction quality, and the edited Qwen3.5-0.8B

Status: in progress (3 November 2026). Protocol: [`PROTOCOL.md`](PROTOCOL.md), written before any new model result.
Running notes, including rejected ideas: [`WORKLOG.md`](WORKLOG.md).

## Questions

1. Where does the shipped extractor (Qwen3.5-4B 4-bit through the app's `SharedExtractor`) lose correct decisions or
   write wrong ones?
2. Can stock Qwen3.5-0.8B, or the 0.8B edited by Weight-Space Programming (Experiment 8), do Memoria's small tasks at
   lower memory or latency?
3. Can a small, explainable change give more correct grounded decisions without losing recall?

## Data

| Split | Series | Gold events | Questions | Role |
|---|---|---|---|---|
| old-dev | ES2003, TS3004 | 23 | 45 | development |
| new-dev | ES2011, IS1008, TS3006 | 37 | 79 | development (gold built here, `specs_new.py`) |
| old-test | ES2004, ES2014, IS1009, TS3003, TS3007 | 46 | 96 | regression only |
| new-val | ES2002, ES2005, ES2010, ES2016, IS1001, IS1004, TS3005, TS3010 | 106 | 247 | the one final validation |

Gold for the new series follows October's procedure exactly (`build_gold.py` imports October's `build_chains.py`
unchanged; October's seven chains rebuild byte-identically from the same pinned annotations). It was hashed and
committed before any model read those transcripts (`data/manifest.json`, commit `0a713e9b1`).

## Files

| File | What it does |
|---|---|
| `PROTOCOL.md`, `WORKLOG.md` | protocol and amendments; dated notes |
| `lease.py`, `queue.sh` | one bounded model job at a time under the shared model lock; peak footprint per job (`results/leases.jsonl`) |
| `lm.py` | model variants and the app worker's requests, cached (`cache/<variant>.jsonl`) |
| `harness.py`, `score.py`, `audit.py`, `controls.py` | the app's extraction on AMI chains; scoring; per-write audit; random-removal controls |
| `support.py`, `consolidate.py`, `numwords.py` | mechanisms tested |
| `wsp.py` | the edit rebuilt, checked against the release, and its survival under 4-bit quantisation |
| `run.py` | model jobs (extract, route, guard, parity, thinkcheck, suite) |
| `validate.py` | preregistration, single run and scoring of the final validation |
| `build_gold.py`, `specs_new.py`, `show_abstracts.py`, `data/` | gold for the new series |
| `check_harness.py`, `test_helpers.py` | no-model checks |
