#!/usr/bin/env bash
# Memoria privacy check. Read-only: it only reads source files and dist/, writes nothing, needs no sudo.
# Lists every http(s)/ws(s) URL in the shipped source (tests, mocks and comments excluded),
# classifies it, and scans dist/ for compiled-in Sentry DSN or PostHog keys.
set -u
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR" || exit 1
ENGINE_DIR="${MEMORIA_ENGINE_DIR:-$APP_DIR/../engine}"

URL_RE='(https?|wss?)://[A-Za-z0-9._~:/?#@!$&()*+,;=%-]+'

# Prints "file:line:url" for every URL in non-test, non-comment code.
collect() {
  find index.html src src-tauri/src \( -name '*.ts' -o -name '*.tsx' -o -name '*.rs' -o -name '*.html' -o -name '*.css' \) \
    ! -name '*.test.*' ! -name '*_tests.rs' ! -path '*/tests/*' ! -path '*/mod_tests/*' ! -path '*/mock-tauri/*' -print0 |
  xargs -0 awk -v re="$URL_RE" '
    FNR == 1 { skip = 0 }
    /#\[cfg\(test\)\]/ { skip = 1 }
    skip { next }
    /^[[:space:]]*(\/\/|\/\*|\*)/ { next }
    {
      line = $0
      while (match(line, re)) {
        url = substr(line, RSTART, RLENGTH)
        sub(/[.,;:)'"'"'"`]+$/, "", url)
        print FILENAME ":" FNR ":" url
        line = substr(line, RSTART + RLENGTH)
      }
    }'
}

classify() { # $1 = file, $2 = url
  local file="$1" url="$2"
  case "$url" in
    *huggingface.co*|*hf.co*) echo "model download"; return ;;
    *localhost*|*127.0.0.1*|*example.com*|*example.ingest*|*w3.org*) echo "local or placeholder"; return ;;
    *opencode.ai/config.json*) echo "other (JSON schema id, not fetched)"; return ;;
    http://|https://|http://*\$*|https://*\$*) echo "other (URL prefix check, not contacted)"; return ;;
  esac
  case "$file" in
    index.html|*.css) echo "other: LOADED AT STARTUP (remote font/stylesheet)" ;;
    *telemetry*|*Telemetry*) echo "telemetry (inert unless keys)" ;;
    *app_updater*|*useUpdater*|*releaseDownloadPage*|*releaseHistoryPage*) echo "updater (disabled)" ;;
    *constants/feedback*) echo "user-initiated (hidden by SHOW_UPSTREAM_LINKS=false)" ;;
    *aiAgents*|*_cli.rs|*_discovery.rs|*ClaudeCodeOnboarding*|*StatusBarBadges*) echo "user-initiated (install/docs link)" ;;
    *CloneVaultModal*|*AddRemoteModal*|*git/*|*getting_started*) echo "user-initiated (git remote chosen by the user)" ;;
    *ai_models*) echo "other (AI provider API, only when the user adds a provider key)" ;;
    *) echo "other" ;;
  esac
}

echo "== Outbound URLs in shipped source =="
printf '%-52s %-52s %s\n' "FILE:LINE" "URL" "CLASS"
declare -a rows=()
while IFS= read -r hit; do
  file="${hit%%:*}"; rest="${hit#*:}"; line="${rest%%:*}"; url="${rest#*:}"
  rows+=("$(classify "$file" "$url")|$file:$line|$url")
done < <(collect | sort -u)
for row in "${rows[@]}"; do
  IFS='|' read -r cls loc url <<<"$row"
  printf '%-52s %-52s %s\n' "${loc:0:52}" "${url:0:52}" "$cls"
done | sort -k3
echo
echo "Summary by class:"
for row in "${rows[@]}"; do echo "${row%%|*}"; done | sort | uniq -c | sort -rn | sed 's/^/  /'

echo
echo "== Run-time network call sites (code that can open a connection) =="
grep -rnE 'reqwest::(Client|blocking)|\bfetch\(|new WebSocket\(|posthog\.init|Sentry\.init|sentry::init|check_for_updates|updater\(\)' src src-tauri/src \
  --include=*.ts --include=*.tsx --include=*.rs 2>/dev/null |
  grep -vE '\.test\.|_tests\.rs|/tests/|mock-tauri' | cut -c1-150 | sed 's/^/  /'

echo
echo "== Content-Security-Policy hosts allowed by tauri.conf.json (what the webview may contact) =="
grep -oE '"(connect-src|img-src|media-src|script-src|font-src|style-src)": "[^"]*"' src-tauri/tauri.conf.json | grep -E 'https:|https://' | cut -c1-170 | sed 's/^/  /'

echo
echo "== Model downloads (Hugging Face) =="
for d in src-tauri/resources/python "$ENGINE_DIR/memoria_engine"; do
  if [ -d "$d" ]; then
    echo "  $d:"
    grep -rnE 'mlx-community/|snapshot_download|hf_hub_download' "$d" --include=*.py 2>/dev/null | cut -c1-140 | sed 's/^/    /' | head -10
  fi
done
echo "  Environment switches that stop downloads: HF_HUB_OFFLINE=1 (set it once the models are cached)."

echo
echo "== Compiled-in telemetry keys in dist/ =="
if [ -d dist ]; then
  sentry=$(grep -rEho 'https://[0-9a-f]{16,}@[A-Za-z0-9.-]+\.sentry\.io/[0-9]+' dist 2>/dev/null | sort -u)
  posthog=$(grep -rEho 'phc_[A-Za-z0-9]{20,}' dist 2>/dev/null | sort -u)
  [ -z "$sentry" ] && echo "  PASS: no Sentry DSN found" || { echo "  FOUND Sentry DSN:"; echo "$sentry" | sed 's/^/    /'; }
  [ -z "$posthog" ] && echo "  PASS: no PostHog key found" || { echo "  FOUND PostHog key:"; echo "$posthog" | sed 's/^/    /'; }
else
  echo "  dist/ not found (run 'pnpm build' first to scan the production bundle)"
fi
echo
echo "== Frontend env keys =="
for var in VITE_SENTRY_DSN VITE_POSTHOG_KEY; do
  if [ -n "${!var:-}" ] || grep -qsE "^$var=.+" .env .env.local .env.production 2>/dev/null; then echo "  $var is set: telemetry can be compiled in"; else echo "  $var is not set"; fi
done
