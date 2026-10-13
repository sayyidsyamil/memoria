#!/usr/bin/env bash
# Memoria doctor: read-only checklist of what this Mac needs before Memoria can
# transcribe meetings and build the decision ledger. Needs no sudo, changes nothing,
# downloads nothing and never loads a model.
#
# Environment: MEMORIA_PYTHON (default /opt/homebrew/bin/python3.11),
#              MEMORIA_ENGINE_DIR (default ../engine next to the app folder).
# Exit status: 0 when READY, 1 when NOT READY.

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="${MEMORIA_PYTHON:-/opt/homebrew/bin/python3.11}"
ENGINE="${MEMORIA_ENGINE_DIR:-$root/../engine}"
REQUIREMENTS="$root/src-tauri/resources/python/requirements.txt"
MIN_FREE_GB=10

failures=0
fixes=()

pass() { printf '  PASS  %s\n' "$1"; }
note() { printf '  INFO  %s\n' "$1"; }
fail() { # fail "what is wrong" "exact fix command"
  printf '  FAIL  %s\n' "$1"
  failures=$((failures + 1))
  fixes+=("$2")
}

echo "Memoria doctor"
echo

# 1. Platform
if [ "$(uname -s)" = "Darwin" ]; then
  pass "macOS $(sw_vers -productVersion 2>/dev/null)"
else
  fail "Memoria needs macOS (found $(uname -s))" "Use a Mac with Apple silicon"
fi
if [ "$(uname -m)" = "arm64" ]; then
  pass "Apple silicon (arm64)"
else
  fail "Apple silicon is required for the local speech and language models (found $(uname -m))" "Use a Mac with an M-series chip"
fi

# 2. Python 3.11
python_ok=0
if [ -x "$PY" ]; then
  version="$("$PY" -c 'import sys; print("%d.%d.%d" % sys.version_info[:3])' 2>/dev/null)"
  case "$version" in
    3.11.*) pass "Python $version at $PY"; python_ok=1 ;;
    *) fail "Python at $PY is version ${version:-unknown}, need 3.11" "brew install python@3.11   (or set MEMORIA_PYTHON to a Python 3.11)" ;;
  esac
else
  fail "Python 3.11 not found at $PY" "brew install python@3.11   (or set MEMORIA_PYTHON to its path)"
fi

# 3. Python packages
if [ "$python_ok" = 1 ]; then
  missing=()
  for module in mlx.core mlx_lm mlx_audio numpy librosa sounddevice; do
    if "$PY" -c "import $module" >/dev/null 2>&1; then
      pass "Python package $module"
    else
      missing+=("$module")
      fail "Python package $module cannot be imported" ""
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    if [ -f "$REQUIREMENTS" ]; then
      fixes+=("\"$PY\" -m pip install -r \"$REQUIREMENTS\"")
    else
      fixes+=("\"$PY\" -m pip install mlx mlx-lm mlx-audio numpy librosa sounddevice")
    fi
  fi
else
  note "Skipped the package check because Python 3.11 is not available"
fi

# 4. Decision engine folder
if [ -f "$ENGINE/memoria_engine/service.py" ]; then
  engine_dir="$(cd "$ENGINE" && pwd)"
  if [ "$python_ok" = 1 ] && (cd "$engine_dir" && "$PY" -m memoria_engine.service --help >/dev/null 2>&1); then
    pass "Decision engine at $engine_dir starts"
  elif [ "$python_ok" = 1 ]; then
    fail "Decision engine at $engine_dir does not start" "cd \"$engine_dir\" && \"$PY\" -m memoria_engine.service --help   (read the error it prints)"
  else
    note "Decision engine found at $engine_dir (start-up test skipped without Python 3.11)"
  fi
else
  fail "Decision engine folder not found at $ENGINE" "Copy the engine folder next to the app, or set MEMORIA_ENGINE_DIR=/path/to/engine (it must contain memoria_engine/)"
fi

# 5. Disk space
free_kb="$(df -Pk "$HOME" 2>/dev/null | awk 'NR==2 {print $4}')"
if [ -n "$free_kb" ]; then
  free_gb=$((free_kb / 1024 / 1024))
  if [ "$free_gb" -ge "$MIN_FREE_GB" ]; then
    pass "Free disk space ${free_gb} GB (need ${MIN_FREE_GB} GB)"
  else
    fail "Only ${free_gb} GB free, need ${MIN_FREE_GB} GB for the models and your meetings" "Free up disk space (Apple menu > System Settings > General > Storage)"
  fi
else
  fail "Could not read free disk space" "df -h \"$HOME\""
fi

# 6. Models already downloaded (information only, never a failure)
hub="${HF_HUB_CACHE:-${HF_HOME:+$HF_HOME/hub}}"
hub="${hub:-$HOME/.cache/huggingface/hub}"
models=(
  "mlx-community/Qwen3.5-4B-MLX-4bit"
  "mlx-community/parakeet-tdt-0.6b-v3"
  "mlx-community/diar_streaming_sortformer_4spk-v2.1-fp16"
  "mlx-community/wespeaker-voxceleb-resnet34-LM"
)
missing_models=0
for model in "${models[@]}"; do
  folder="$hub/models--${model//\//--}"
  if [ -d "$folder/snapshots" ] && [ -n "$(ls -A "$folder/snapshots" 2>/dev/null)" ]; then
    pass "Model ${model#*/} is already downloaded"
  else
    missing_models=$((missing_models + 1))
    note "Model ${model#*/} will be downloaded on first use"
  fi
done
if [ "$missing_models" -gt 0 ]; then
  note "$missing_models of ${#models[@]} models missing: they will be downloaded on first use, about 5 GB in total, and need internet once (checked in $hub)"
fi

# 7. git
if command -v git >/dev/null 2>&1 && git --version >/dev/null 2>&1; then
  pass "$(git --version)"
else
  fail "git is not installed (the starter vault and note history need it)" "xcode-select --install"
fi

echo
if [ "$failures" -eq 0 ]; then
  echo "READY"
  exit 0
fi
echo "NOT READY ($failures problem(s)). Fix with:"
for fix in "${fixes[@]}"; do
  [ -n "$fix" ] && echo "  $fix"
done
exit 1
