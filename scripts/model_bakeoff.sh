#!/bin/zsh
# Language-model bake-off for the app (run with the app quit: one model in memory at a time).
# For each model: UAT demo extraction (answer key) and the app's live check on MemoriaBench dev.
# Usage: model_bakeoff.sh <out-dir> <model> [<model> ...]
set -u
out=${1:A}; shift
repo=${0:A:h}/../..
memory=$repo/src-tauri/resources/memory
mkdir -p $out
for model in "$@"; do
  name=${model:t}
  sock=$TMPDIR/bake-$name.sock
  rm -f $sock $sock.lock
  start=$(date +%s)
  MEMORIA_LLM_MODEL=$model /opt/homebrew/bin/python3.11 -u $memory/model_server.py $sock --resident > $out/$name.server.log 2>&1 &
  server=$!
  for i in $(seq 1 120); do grep -q '"ready"' $out/$name.server.log 2>/dev/null && break; sleep 2; done
  print -r -- "$name ready after $(( $(date +%s) - start ))s: $(grep '"ready"' $out/$name.server.log)"
  vault=$out/$name-demo
  rm -rf $vault
  /opt/homebrew/bin/python3.11 -W ignore $repo/scripts/uat/build_demo_vault.py $vault > /dev/null 2>&1
  t=$(date +%s)
  MEMORIA_QWEN_SOCKET=$sock $repo/scripts/uat/dry_run.sh $vault > $out/$name.ingest.txt 2>&1
  print -r -- "$name demo ingest $(( $(date +%s) - t ))s"
  /opt/homebrew/bin/python3.11 -W ignore $repo/scripts/uat/score_demo.py $vault 2>/dev/null | grep -v '"progress"' > $out/$name.demo.json
  t=$(date +%s)
  MEMORIA_QWEN_SOCKET=$sock MEMORIA_GUARD=on /opt/homebrew/bin/python3.11 $repo/research/memoriabench/app_live_check_bench.py \
    --split dev --output $out/$name.dev.jsonl 2>/dev/null | grep -v '"progress"' > $out/$name.dev.summary.json
  print -r -- "$name dev bench $(( $(date +%s) - t ))s"
  kill $server 2>/dev/null; wait $server 2>/dev/null
done
