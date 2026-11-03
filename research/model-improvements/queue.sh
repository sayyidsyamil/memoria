#!/bin/zsh
# Run model jobs one lease at a time: queue.sh <log> <label> <run.py args> [-- <label> <run.py args> ...]
# Each lease takes the shared model lock, runs one bounded job, frees the model and releases the lock.
cd ${0:A:h}
log=$1; shift
py=/Users/Shared/Memoria/runtime/speech/bin/python
while (( $# )); do
  label=$1; shift
  job=()
  while (( $# )) && [[ $1 != "--" ]]; do job+=$1; shift; done
  (( $# )) && shift
  print -r -- "=== $(date '+%H:%M:%S') $label: $job" >> $log
  /opt/homebrew/bin/python3.11 -B lease.py $label -- $py -B run.py $job >> $log 2>&1
done
print -r -- "=== $(date '+%H:%M:%S') queue done" >> $log
