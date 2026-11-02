#!/bin/zsh
# UAT dry run of T1 (take the three meetings in) through the running app's own engine requests and
# resident models, then print what T2-T4 would show. Usage: dry_run.sh <vault>
vault=${1:A}
pid=$(pgrep -f "Memoria Workspace.app/Contents/MacOS/memoria" | head -1)
# An explicit MEMORIA_QWEN_SOCKET (an evaluation worker) wins over the running app's.
export MEMORIA_QWEN_SOCKET=${MEMORIA_QWEN_SOCKET:-$(print -r -- $TMPDIR/mm-$pid-*-qwen.sock(N))}
export MEMORIA_EMBED_SOCKET=${MEMORIA_EMBED_SOCKET:-$(print -r -- $TMPDIR/mm-$pid-*-embed.sock(N))}
[[ -S $MEMORIA_QWEN_SOCKET ]] || { print "no app Qwen socket"; exit 1; }
engine=${0:A:h}/../../src-tauri/resources/memory/engine.py
for meeting in $(cd $vault/.memoria-recordings && ls); do
  start=$(date +%s)
  print -r -- '{"action":"temporal_api","vaultPath":"'$vault'","method":"ingest_reviewed_meeting","params":{"meetingId":"'$meeting'"}}' \
    | /opt/homebrew/bin/python3.11 -u $engine 2>/dev/null | grep -v '"progress"' | /opt/homebrew/bin/python3.11 -c "
import json, sys
r = json.loads(sys.stdin.read())
data = (r.get('result') or {}).get('data') or {}
print('$meeting'[:8], '$(( $(date +%s) - start ))s', r.get('error') or (r.get('result') or {}).get('error') or data.get('counts'))"
done
