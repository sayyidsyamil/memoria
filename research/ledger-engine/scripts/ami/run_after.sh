#!/bin/bash
# Remaining AMI jobs, strictly one model process at a time, after the test-split baselines (already running as pid $1):
#   1. Memoria on the test split with an oracle reviewer (upper bound of the review inbox), frozen code
#   (the dev-split baselines were moved to the very end and are run by hand after the engine fixes)
# Replaces run_rest.sh / run_queue.sh, which were stopped after test_baselines started so that the review run comes before the slow dev baselines.
#   nohup caffeinate -ims bash scripts/ami/run_after.sh <pid> &
cd "$(dirname "$0")/../.." || exit 1
PY=/opt/homebrew/bin/python3.11
frozen() { (find memoria_engine data/ami_v0 -type f \( -name '*.py' -o -name '*.chain' -o -name '*.ask' \) -not -path '*/__pycache__/*' | sort | xargs shasum -a 256 | shasum -a 256 | cut -c1-12); }
log() { echo "[$(date '+%F %T')] $*" | tee -a logs/ami_run.log; }
step() { local name=$1; shift; log "START $name (code+data hash $(frozen))"; "$@" >> "logs/ami_$name.log" 2>&1; local rc=$?; log "END   $name rc=$rc"; return $rc; }
BASELINES_PID=${1:?pid of the running test_baselines process}
log "driver run_after.sh starts (code+data hash $(frozen)); run_rest.sh and run_queue.sh were stopped by hand; waiting for test_baselines pid $BASELINES_PID"
while kill -0 "$BASELINES_PID" 2>/dev/null; do sleep 30; done
log "END   test_baselines (pid $BASELINES_PID ended; output file decides success)"
cp -n results/cache/ami_test_memoria.jsonl results/cache/ami_test_memoria_review.jsonl
step test_memoria_review $PY scripts/ami/run_ami_review.py --split test --part memoria --cache results/cache/ami_test_memoria_review.jsonl --out results/ami/memoria_test_review.json
log "driver run_after.sh ends (code+data hash $(frozen)); the engine fixes (results/testing/proposed_fixes.patch and the service fixes) may be applied now. The dev baselines are run last, by hand, with the patched code (replay_offline.py shows the patched code reproduces the frozen runs)."
