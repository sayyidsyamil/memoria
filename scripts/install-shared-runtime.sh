#!/bin/bash
# Provision once as the developer; never launches Memoria or loads model weights.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
exec /opt/homebrew/bin/python3.11 "$SCRIPT_DIR/runtime/install_shared.py" "$@"
