#!/bin/zsh
# Before each UAT participant: restore the working demo vault from the pristine starter vault,
# which also removes any tracked facts, approved knowledge, briefs and saved voice profiles.
# Quit Memoria first.
#   scripts/uat/reset-demo.sh [working-vault] [pristine-vault]
set -eu
work=${1:-$HOME/Documents/Memoria UAT}
pristine=${2:-/Users/Shared/Memoria/demo-vault}
if pgrep -f "Memoria Workspace.app/Contents/MacOS/memoria" >/dev/null || pgrep -f "Memoria.app/Contents/MacOS/memoria" >/dev/null; then
  print "Quit Memoria first."; exit 1
fi
[[ -f "$pristine/.memoria-memory/temporal/registry.json" ]] || { print "No starter vault at $pristine (build it with scripts/uat/build_demo_vault.py)."; exit 1; }
mkdir -p "$work"
rsync -a --delete "$pristine/" "$work/"
print "Reset $work from $pristine: $(ls "$work/meetings" | wc -l | tr -d ' ') meetings, nothing tracked yet, no voice profiles."
