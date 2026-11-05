#!/bin/bash
# Dev-split baselines, run last, on the fixed engine (the baseline path does not use any fixed code; replay_offline.py showed the fixed code reproduces the frozen runs).
# Resumable: every call is cached. Stop with kill; start again to continue.
cd "$(dirname "$0")/../.." || exit 1
PY=/opt/homebrew/bin/python3.11
log() { echo "[$(date '+%F %T')] $*" | tee -a logs/ami_run.log; }
log "START dev_baselines (engine fixed on 14 Oct; code hash of memoria_engine $(find memoria_engine -name '*.py' -not -path '*/__pycache__/*' | sort | xargs shasum -a 256 | shasum -a 256 | cut -c1-12))"
$PY scripts/ami/run_ami.py --split dev --part baselines --configs fc+cot,bm25-12 --cache results/cache/ami_dev_baselines.jsonl --out results/ami/baselines_dev.json >> logs/ami_dev_baselines.log 2>&1
log "END   dev_baselines rc=$?"
