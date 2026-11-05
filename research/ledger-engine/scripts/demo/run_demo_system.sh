#!/bin/bash
# The two service-level system tests of the demo series (second run after the v3 changes), one model process at a time.
cd "$(dirname "$0")/../.." || exit 1
PY=/opt/homebrew/bin/python3.11
log() { echo "[$(date '+%F %T')] $*" | tee -a logs/demo_run.log; }
log "system tests rerun begin; engine code hash $(find memoria_engine -name '*.py' -not -path '*/__pycache__/*' | sort | xargs shasum -a 256 | shasum -a 256 | cut -c1-12)"
$PY scripts/demo/system_test.py --extractor mlx --reviewer accept_all --out results/demo/system_test_accept_all --snapshot results/demo/service_snapshot_accept_all.json >> logs/demo_system_accept_all.log 2>&1; log "END system_accept_all rc=$?"
$PY scripts/demo/system_test.py --extractor mlx --reviewer careful --out results/demo/system_test_careful --snapshot results/demo/service_snapshot.json >> logs/demo_system_careful.log 2>&1; log "END system_careful rc=$?"
