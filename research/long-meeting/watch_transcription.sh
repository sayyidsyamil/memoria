#!/bin/zsh
# Follow the native long transcription: log the review's stage text every 30 s and the moment
# transcript-draft.json appears (or the review reports an error). Ends after 75 minutes at most.
cd "${0:A:h}"
log=transcribe.watch.log
start=$(cat transcribe.start)
: > $log
for i in $(seq 1 150); do
  now=$(date +%s)
  stage=$(agent-desktop find --app Memoria --role statictext 2>/dev/null | /opt/homebrew/bin/python3.11 -c "
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print('?'); sys.exit()
names = [m.get('name') or m.get('value') or '' for m in d.get('data', {}).get('matches', [])]
hits = [n for n in names if any(k in n for k in ('Transcribing', 'Loading', 'Matching', 'Retrying', 'transcript is ready', 'timed out', 'failed', 'Failed', 'error', 'Error', 'original recording is saved', 'passage needs'))]
print(' || '.join(hits[:3]) or '-')
")
  print -r -- "$((now - start))s $stage" >> $log
  if ls vault/.memoria-recordings/*/transcript-draft.json >/dev/null 2>&1; then
    print -r -- "$((now - start))s DRAFT WRITTEN" >> $log; break
  fi
  case "$stage" in *"timed out"*|*"original recording is saved"*) print -r -- "$((now - start))s STOPPED" >> $log; break;; esac
  sleep 30
done
tail -4 $log
