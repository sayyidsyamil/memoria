#!/bin/bash
# Continues the AMI evaluation after run_all.sh was stopped: its dev_baselines step died with a Metal out-of-memory
# (rc=134) when three model processes shared the 16 GB GPU, so the remaining steps are now strictly one after another.
#   nohup caffeinate -ims bash scripts/ami/run_rest.sh &
cd "$(dirname "$0")/../.." || exit 1
PY=/opt/homebrew/bin/python3.11
mkdir -p results/ami logs
frozen() { (find memoria_engine data/ami_v0 -type f \( -name '*.py' -o -name '*.chain' -o -name '*.ask' \) -not -path '*/__pycache__/*' | sort | xargs shasum -a 256 | shasum -a 256 | cut -c1-12); }
log() { echo "[$(date '+%F %T')] $*" | tee -a logs/ami_run.log; }
step() { local name=$1; shift; log "START $name (code+data hash $(frozen))"; "$@" >> "logs/ami_$name.log" 2>&1; local rc=$?; log "END   $name rc=$rc"; return $rc; }
wait_pid() { while kill -0 "$1" 2>/dev/null; do sleep 20; done; }
wait_quiet() { while pgrep -f "asr_der_eval.py" > /dev/null || pgrep -f "check_fast_equivalence" > /dev/null; do sleep 30; done; }

TEST_MEMORIA_PID=${1:?pid of the running test_memoria process}
log "driver run_rest.sh starts (code+data hash $(frozen)); waiting for test_memoria pid $TEST_MEMORIA_PID"
wait_pid "$TEST_MEMORIA_PID"
log "END   test_memoria (pid $TEST_MEMORIA_PID ended; output file decides success)"
wait_quiet
log "START fast_equivalence"
$PY scripts/ami/check_fast_equivalence.py --reference results/cache/ami_dev_baselines.jsonl --n 4 > logs/fast_equiv.log 2>&1
RUNNER=run_ami.py
if tail -1 logs/fast_equiv.log | $PY -c 'import json,sys; r=json.loads(sys.stdin.read()); sys.exit(0 if r["compared"]>=3 and r["same_verdict"]==r["compared"] else 1)'; then RUNNER=run_ami_fast.py; fi
log "END   fast_equivalence -> runner $RUNNER ($(tail -1 logs/fast_equiv.log | cut -c1-200))"
step test_baselines $PY scripts/ami/$RUNNER --split test --part baselines --configs fc+cot,bm25-12 --cache results/cache/ami_test_baselines.jsonl --out results/ami/baselines_test.json
step dev_baselines  $PY scripts/ami/$RUNNER --split dev  --part baselines --configs fc+cot,bm25-12 --cache results/cache/ami_dev_baselines.jsonl  --out results/ami/baselines_dev.json
log "driver run_rest.sh ends (code+data hash $(frozen))"
