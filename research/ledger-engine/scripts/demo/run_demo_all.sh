#!/bin/bash
# The demo-series jobs that need the model, strictly one after another (one MLX process at a time on the 16 GB machine).
#   nohup caffeinate -ims bash scripts/demo/run_demo_all.sh &
cd "$(dirname "$0")/../.." || exit 1
PY=/opt/homebrew/bin/python3.11
mkdir -p logs results/demo
log() { echo "[$(date '+%F %T')] $*" | tee -a logs/demo_run.log; }
step() { local name=$1; shift; log "START $name"; "$@" >> "logs/demo_$name.log" 2>&1; local rc=$?; log "END   $name rc=$rc"; return $rc; }
log "demo jobs begin (v3: value-in-quote check, fallback router); engine code hash $(find memoria_engine -name '*.py' -not -path '*/__pycache__/*' | sort | xargs shasum -a 256 | shasum -a 256 | cut -c1-12)"
step system_accept_all $PY scripts/demo/system_test.py --extractor mlx --reviewer accept_all --out results/demo/system_test_accept_all --snapshot results/demo/service_snapshot_accept_all.json
step system_careful    $PY scripts/demo/system_test.py --extractor mlx --reviewer careful    --out results/demo/system_test_careful    --snapshot results/demo/service_snapshot.json
step eval_immediate    $PY scripts/demo/run_demo_eval.py --policy immediate --out results/demo/demo_eval_immediate.json
step eval_review       $PY scripts/demo/run_demo_eval.py --policy review --part memoria --out results/demo/demo_eval_review.json
log "demo jobs end"
