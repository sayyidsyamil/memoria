#!/bin/zsh
# Build knowledge from the reviewed 60-minute transcript, then add it to tracked facts, through the
# installed app's engine.py and its resident models (same requests the app sends; no UI).
cd "${0:A:h}"
pid=$(pgrep -f "Memoria Workspace.app/Contents/MacOS/memoria")
export MEMORIA_QWEN_SOCKET=$(print -r -- $TMPDIR/mm-$pid-*-qwen.sock)
export MEMORIA_EMBED_SOCKET=$(print -r -- $TMPDIR/mm-$pid-*-embed.sock)
export MEMORIA_SPEECH_SOCKET=$(print -r -- $TMPDIR/mm-$pid-*-speech.sock)
engine="$HOME/Applications/Memoria Workspace.app/Contents/Resources/memory/engine.py"
vault=$PWD/vault
source=$(cd vault && ls source-*reviewed-transcript*.md | head -1)
meeting=$(ls vault/.memoria-recordings/)
run() {  # name, request
  local start=$(date +%s)
  print -r -- "$2" | /opt/homebrew/bin/python3.11 -u "$engine" 2> $1.err | while IFS= read -r line; do print -r -- "$(( $(date +%s) - start ))s ${line:0:300}"; done > $1.log
  print -r -- "$1: $(( $(date +%s) - start ))s; $(grep -c progress $1.log) progress lines; $(grep -v '"progress"' $1.log | cut -c1-160 | tail -1)"
}
run compile '{"action":"compile","vaultPath":"'$vault'","sourcePath":"'$source'"}'
run ingest '{"action":"temporal_api","vaultPath":"'$vault'","method":"ingest_reviewed_meeting","params":{"meetingId":"'$meeting'"}}'
