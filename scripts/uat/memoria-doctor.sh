#!/bin/zsh
# Read-only check before a UAT session, from any macOS account on this Mac. Prints READY, or
# what is missing and how to fix it. Loads no model and changes nothing.
#   scripts/uat/memoria-doctor.sh [working-vault]
set -u
shared=/Users/Shared/Memoria
work=${1:-$HOME/Documents/Memoria UAT}
missing=()
ok() { print "  ok    $1"; }
bad() { print "  MISSING $1"; missing+=("$1"); }
note() { print "  note  $1"; }

print "Memoria UAT check for $(id -un) on $(sw_vers -productName) $(sw_vers -productVersion), $(sysctl -n hw.memsize | awk '{printf "%.0f GB", $1/1073741824}')"

app=""
for candidate in /Applications/Memoria.app "$HOME/Applications/Memoria.app" "$HOME/Applications/Memoria Workspace.app"; do
  [[ -x "$candidate/Contents/MacOS/memoria" ]] && { app=$candidate; break; }
done
autoload -Uz is-at-least
if [[ -n $app ]]; then
  version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist" 2>/dev/null)
  if is-at-least 0.3.2 "${version:-0}"; then
    ok "app: $app (version $version)"
  else
    bad "app: $app is version $version; install the 0.3.2 UAT release (.dmg) into /Applications"
  fi
else
  bad "app: install Memoria.app into /Applications from the release .dmg"
fi

[[ -x /opt/homebrew/bin/python3.11 ]] && ok "Python 3.11: /opt/homebrew/bin/python3.11" || bad "Python 3.11: brew install python@3.11 (as the developer account)"
[[ -x /opt/homebrew/bin/ffmpeg ]] && ok "ffmpeg: /opt/homebrew/bin/ffmpeg" || bad "ffmpeg: brew install ffmpeg (as the developer account)"

for kind in speech embed; do
  base=$shared/runtime/$kind
  if [[ -f $base/.memoria-complete && -x $base/bin/python ]] && "$base/bin/python" -c 'import sys' 2>/dev/null; then
    ok "$kind runtime: $base"
  else
    bad "$kind runtime: run scripts/install-shared-runtime.sh --copy-developer from the developer account"
  fi
done
if [[ -f $shared/hf/.memoria-complete && -r $shared/hf/hub ]]; then
  ok "models: $shared/hf ($(ls -d $shared/hf/hub/models--* 2>/dev/null | wc -l | tr -d ' ') snapshots)"
else
  bad "models: run scripts/install-shared-runtime.sh --copy-developer from the developer account"
fi

if [[ -f $shared/demo-vault/.memoria-memory/temporal/registry.json ]]; then
  ok "starter vault: $shared/demo-vault"
else
  bad "starter vault: python3.11 scripts/uat/build_demo_vault.py $shared/demo-vault (developer account)"
fi
if [[ -d $work/meetings ]]; then
  ok "working vault: $work ($(ls "$work/meetings" | wc -l | tr -d ' ') meetings)"
else
  bad "working vault: run $shared/reset-demo.sh (copies the starter vault to $work)"
fi

free=$(df -g "$HOME" | awk 'NR==2 {print $4}')
(( free >= 5 )) && ok "disk: ${free} GB free" || bad "disk: only ${free} GB free (need 5 GB)"
memory=$(memory_pressure 2>/dev/null | awk -F': ' '/free percentage/ {print $2}')
[[ -n $memory ]] && note "memory free now: $memory (close other large apps if under 20%; the speech, language and search models need about 6 GB together)"
note "microphone: the first recording asks for permission; allow it once for this account"

if (( ${#missing} == 0 )); then
  print "READY"
else
  print "NOT READY: ${#missing} item(s) above"
  exit 1
fi
