#!/usr/bin/env bash
# Build the release Memoria.app and .dmg and write docs/RELEASE_RECORD.md.
#
#   pnpm build-release        (or)   bash scripts/build-release.sh
#
# Refuses to run on a dirty working tree or when telemetry keys are set, so a release can only
# come from a committed state and cannot carry a Sentry/PostHog key. Heavy (a full release
# compile): run it on an idle machine.
set -euo pipefail

cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
BUNDLE_DIR="src-tauri/target/release/bundle"
STAGE_DIR="src-tauri/target/release-staging"

fail() { echo "✗ $*" >&2; exit 1; }

echo "▸ checking the working tree and environment…"
[ -z "$(git status --porcelain)" ] || fail "working tree is not clean. Commit or stash your changes first."
for var in SENTRY_DSN VITE_SENTRY_DSN VITE_POSTHOG_KEY VITE_POSTHOG_HOST; do
  [ -z "${!var:-}" ] || fail "$var is set in the environment. Unset it: releases must not contain telemetry keys."
done
if grep -qsE '^(VITE_SENTRY_DSN|VITE_POSTHOG_KEY|SENTRY_DSN)=.+' .env .env.local .env.production .env.production.local 2>/dev/null; then
  fail "a .env file sets a Sentry or PostHog key. Remove it before building a release."
fi

COMMIT="$(git rev-parse HEAD)"
VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"

echo "▸ staging a clean copy of the engine (no __pycache__ / .pyc)…"
ENGINE_SRC="${MEMORIA_ENGINE_DIR:-$APP_DIR/../engine}/memoria_engine"
[ -d "$ENGINE_SRC" ] || fail "engine not found at $ENGINE_SRC (set MEMORIA_ENGINE_DIR)."
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
rsync -a --exclude '__pycache__' --exclude '*.pyc' --exclude '.DS_Store' "$ENGINE_SRC/" "$STAGE_DIR/memoria_engine/"

echo "▸ bundling mcp-server…"
pnpm bundle-mcp

echo "▸ building frontend…"
./node_modules/.bin/vite build

echo "▸ building Memoria.app and .dmg (release)…"
# JSON merge patch: a null removes the default engine resource, which would copy __pycache__.
./node_modules/.bin/tauri build \
  --config '{"build":{"beforeBuildCommand":""},"bundle":{"targets":["app","dmg"],"createUpdaterArtifacts":false,"resources":{"../../engine/memoria_engine/**/*":null,"target/release-staging/memoria_engine/**/*":"engine/memoria_engine/"}}}'

APP="$BUNDLE_DIR/macos/Memoria.app"
DMG="$(ls -t "$BUNDLE_DIR"/dmg/*.dmg 2>/dev/null | head -n 1 || true)"
[ -d "$APP" ] || fail "$APP was not produced."
[ -n "$DMG" ] || fail "no .dmg found in $BUNDLE_DIR/dmg."

echo "▸ checking the bundle contents…"
RES="$APP/Contents/Resources"
for path in demo-vault python engine/memoria_engine; do
  [ -d "$RES/$path" ] || fail "$RES/$path is missing from the bundle."
done
[ -f "$RES/python/requirements.txt" ] || fail "python/requirements.txt is missing from the bundle."
if find "$RES" -name '__pycache__' -o -name '*.pyc' | grep -q .; then
  fail "the bundle contains __pycache__/.pyc files under $RES (the engine staging step did not take effect)."
fi
echo "  PASS: demo-vault, python and engine/memoria_engine present; no __pycache__"

echo "▸ scanning dist/ for telemetry keys and remote fonts…"
PRIVACY="$(bash scripts/privacy-check.sh)"
echo "$PRIVACY" | sed -n '/Compiled-in telemetry keys/,$p' | sed 's/^/  /'
echo "$PRIVACY" | sed -n '/Compiled-in telemetry keys/,$p' | grep -q 'FOUND' && fail "privacy scan found a compiled-in telemetry key."
grep -rlE 'fonts\.googleapis\.com|fonts\.gstatic\.com' dist >/dev/null 2>&1 && fail "dist/ references a Google font host."

echo "▸ checksums…"
DMG_SHA="$(shasum -a 256 "$DMG" | awk '{print $1}')"
BIN_LINES=""
for bin in "$APP"/Contents/MacOS/*; do
  BIN_LINES="${BIN_LINES}$(shasum -a 256 "$bin" | awk '{print $1}')  $(basename "$bin")"$'\n'
done
echo "  $DMG_SHA  $(basename "$DMG")"
printf '%s' "$BIN_LINES" | sed 's/^/  /'
echo "  commit $COMMIT"

mkdir -p docs
cat > docs/RELEASE_RECORD.md <<RECORD
# Release record

| | |
|---|---|
| Version | $VERSION |
| Built on | $(date '+%Y-%m-%d %H:%M %Z') |
| Git commit | \`$COMMIT\` |
| Disk image | \`$(basename "$DMG")\` |
| Disk image SHA-256 | \`$DMG_SHA\` |
| Machine | $(sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -m), macOS $(sw_vers -productVersion 2>/dev/null || uname -r), $(uname -m) |
| rustc | $(rustc --version) |
| cargo | $(cargo --version) |
| node | $(node --version) |
| pnpm | $(pnpm --version) |
| tauri-cli | $(./node_modules/.bin/tauri --version) |
| Telemetry keys | none in the environment or .env files; \`dist/\` scan clean |
| Bundle check | demo-vault, python, engine/memoria_engine present; no __pycache__ |

App binary SHA-256 (\`Memoria.app/Contents/MacOS\`):

\`\`\`
${BIN_LINES}\`\`\`

The build is ad-hoc signed (\`signingIdentity "-"\`), so on another Mac the first open needs right-click > Open.
RECORD

echo "✓ release built."
echo "  app: $APP"
echo "  dmg: $DMG"
echo "  record: docs/RELEASE_RECORD.md"
