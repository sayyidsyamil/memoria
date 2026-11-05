#!/bin/bash
# Final scaling run on the held-out test split, then the report. Sequential on purpose (one GPU, clean timings).
# Resumable: every LLM call is cached, so running this script again continues where an interruption stopped.
# Do not edit memoria_engine/ or data/ while it runs: each step is a new process and would pick the edit up (the hash in the log shows it).
#
#   caffeinate -ims bash scripts/run_test_split.sh
cd "$(dirname "$0")/.." || exit 1
PY=python3.11
mkdir -p results/test results/dev logs

frozen() { (find memoria_engine data -type f \( -name '*.py' -o -name '*.chain' -o -name '*.ask' -o -name '*.alt' \) -not -path '*/__pycache__/*' | sort | xargs shasum -a 256 | shasum -a 256 | cut -c1-12); }
log() { echo "[$(date '+%F %T')] $*" | tee -a logs/test_run.log; }
step() { local name=$1; shift; log "START $name (code+data hash $(frozen))"; "$@" >> "logs/test_$name.log" 2>&1; local rc=$?; log "END   $name rc=$rc"; return $rc; }

log "run begins; code+data hash $(frozen)"
START_HASH=$(frozen)

# 1. Memoria, real extractor and router, K = 0, 8, 24, 48
step memoria $PY -m memoria_engine.evaluation.run_scaling --part memoria --split test --levels 0,8,24,48 --extractor mlx --router mlx \
  --cache results/cache/test_memoria.jsonl --out results/test/memoria_test.json

# 2. Baselines on dev with the corrected chain-of-thought budget, then the pre-declared selection rule
step dev_baselines $PY -m memoria_engine.evaluation.run_scaling --part baselines --split dev --levels 24 \
  --configs fc,fc+cot,bm25-6,bm25-12,bm25-6+cot,bm25-12+cot --cache results/cache/dev_baselines.jsonl --out results/dev/baselines_dev_k24_fixedcot.json
$PY -m memoria_engine.evaluation.select_baselines results/dev/baselines_dev_k24_fixedcot.json | tee results/dev/selected.txt >> logs/test_run.log
CONFIGS=$(sed -n 's/^--configs //p' results/dev/selected.txt)
SELECT=$(sed -n 's/^--select "\(.*\)"$/\1/p' results/dev/selected.txt)
[ -n "$CONFIGS" ] || { log "baseline selection failed; stopping"; exit 2; }
log "chosen on dev: configs=$CONFIGS select=$SELECT"

# 3. The chosen baselines on test
step baselines $PY -m memoria_engine.evaluation.run_scaling --part baselines --split test --levels 0,8,24,48 --configs "$CONFIGS" \
  --cache results/cache/test_baselines.jsonl --out results/test/baselines_test.json

# 4. Memoria again with the second phrasing of every question (extraction calls are cache hits; only routing runs)
step memoria_alt $PY -m memoria_engine.evaluation.run_scaling --part memoria --split test --levels 0,8,24,48 --extractor mlx --router mlx --wording alt \
  --cache results/cache/test_memoria.jsonl --out results/test/memoria_test_alt.json

# 5. Report
$PY -m memoria_engine.evaluation.scaling_report --memoria results/test/memoria_test.json --baselines results/test/baselines_test.json \
  --select "$SELECT" --svg results/test/scaling_test.svg > results/test/scaling_report.txt 2>> logs/test_run.log
log "report written (rc=$?)"
[ "$(frozen)" = "$START_HASH" ] && log "code+data unchanged since the start ($START_HASH)" || log "WARNING: code or data changed during the run"
log "ALL-DONE"
