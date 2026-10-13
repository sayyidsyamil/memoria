#!/usr/bin/env bash
# Put the demo back to its starting state for the next user-test participant:
# removes the decision ledger of one vault (the notes stay) and, with --voices, the saved voice profiles.
#   bash scripts/reset-demo.sh                                  # vault: ~/Documents/Getting Started
#   bash scripts/reset-demo.sh "/path/to/vault" --voices
# Quit Memoria first: the ledger database is open while the app runs.
set -euo pipefail

VAULT="$HOME/Documents/Getting Started"
VOICES=0
for arg in "$@"; do
  case "$arg" in
    --voices) VOICES=1 ;;
    *) VAULT="$arg" ;;
  esac
done

if pgrep -f "Memoria.app/Contents/MacOS" > /dev/null; then
  echo "Memoria is running. Quit it first (Cmd+Q), then run this again." >&2
  exit 1
fi

KEY="${VAULT%/}"
HASH8="$(printf '%s' "$KEY" | shasum -a 1 | cut -c1-8)"
LEDGER="$HOME/Library/Application Support/com.memoria.app/ledger/$HASH8"

if [ -d "$LEDGER" ]; then
  rm -rf "$LEDGER"
  echo "Removed the ledger for: $KEY"
else
  echo "No ledger found for: $KEY (nothing to reset)"
fi

if [ "$VOICES" = "1" ]; then
  if [ -d "$HOME/.memoria" ]; then
    rm -rf "$HOME/.memoria"
    echo "Removed saved voice profiles (~/.memoria)"
  else
    echo "No voice profiles stored"
  fi
fi
echo "Ready for the next participant. Open Memoria > Decisions & commitments."
