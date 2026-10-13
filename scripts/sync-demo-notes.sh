#!/usr/bin/env bash
# Copies the three fictional demo meetings from the decision-engine repo into the
# bundled starter vault. Run after the engine's demo notes change.
# Usage: scripts/sync-demo-notes.sh [path-to-engine-demo-folder]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="${1:-$root/../engine/data/demo}"
target_dir="$root/src-tauri/resources/demo-vault"

# Saved transcript notes are named after their title, as the app names them.
names=(
  "meeting_1.md|Procurement pilot kick-off.md"
  "meeting_2.md|Procurement pilot progress check.md"
  "meeting_3.md|Procurement pilot pre-launch review.md"
)

if [ ! -d "$source_dir" ]; then
  echo "Demo folder not found: $source_dir" >&2
  exit 1
fi

for pair in "${names[@]}"; do
  from="${pair%%|*}"
  to="${pair#*|}"
  cp "$source_dir/$from" "$target_dir/$to"
  echo "copied $from -> $to"
done
