#!/bin/bash
# GPU jobs that must wait for run_rest.sh to finish (one model process at a time on the 16 GB machine).
#   nohup caffeinate -ims bash scripts/ami/run_queue.sh <pid of run_rest.sh> &
# Order: Memoria on the test split with an oracle reviewer (frozen code), then it stops.
# The demo system test is run afterwards by hand, on the patched engine.
cd "$(dirname "$0")/../.." || exit 1
PY=/opt/homebrew/bin/python3.11
frozen() { (find memoria_engine data/ami_v0 -type f \( -name '*.py' -o -name '*.chain' -o -name '*.ask' \) -not -path '*/__pycache__/*' | sort | xargs shasum -a 256 | shasum -a 256 | cut -c1-12); }
log() { echo "[$(date '+%F %T')] $*" | tee -a logs/ami_run.log; }
step() { local name=$1; shift; log "START $name (code+data hash $(frozen))"; "$@" >> "logs/ami_$name.log" 2>&1; local rc=$?; log "END   $name rc=$rc"; return $rc; }
RUN_REST_PID=${1:?pid of run_rest.sh}
log "queue driver starts; waiting for run_rest.sh pid $RUN_REST_PID"
while kill -0 "$RUN_REST_PID" 2>/dev/null; do sleep 30; done
# Reuse the router calls and the first-meeting extraction calls of the immediate-policy run (their prompts are identical).
cp -n results/cache/ami_test_memoria.jsonl results/cache/ami_test_memoria_review.jsonl
step test_memoria_review $PY scripts/ami/run_ami_review.py --split test --part memoria --cache results/cache/ami_test_memoria_review.jsonl --out results/ami/memoria_test_review.json
log "queue driver ends; the engine may be modified now (apply results/testing/proposed_fixes.patch), then run the demo system test"
