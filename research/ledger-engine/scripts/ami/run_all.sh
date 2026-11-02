#!/bin/bash
# Sequential on purpose: one GPU, clean timings. Resumable: every LLM call is cached.
#   caffeinate -ims bash scripts/ami/run_all.sh
cd "$(dirname "$0")/../.." || exit 1
PY=/opt/homebrew/bin/python3.11
mkdir -p results/ami logs
frozen() { (find memoria_engine data/ami_v0 -type f \( -name '*.py' -o -name '*.chain' -o -name '*.ask' \) -not -path '*/__pycache__/*' | sort | xargs shasum -a 256 | shasum -a 256 | cut -c1-12); }
log() { echo "[$(date '+%F %T')] $*" | tee -a logs/ami_run.log; }
step() { local name=$1; shift; log "START $name (code+data hash $(frozen))"; "$@" >> "logs/ami_$name.log" 2>&1; local rc=$?; log "END   $name rc=$rc"; return $rc; }
log "run begins; code+data hash $(frozen)"
step dev_baselines  $PY scripts/ami/run_ami.py --split dev  --part baselines --configs fc+cot,bm25-12 --cache results/cache/ami_dev_baselines.jsonl  --out results/ami/baselines_dev.json
step test_memoria   $PY scripts/ami/run_ami.py --split test --part memoria                           --cache results/cache/ami_test_memoria.jsonl   --out results/ami/memoria_test.json
step test_baselines $PY scripts/ami/run_ami.py --split test --part baselines --configs fc+cot,bm25-12 --cache results/cache/ami_test_baselines.jsonl --out results/ami/baselines_test.json
log "run ends; code+data hash $(frozen)"
