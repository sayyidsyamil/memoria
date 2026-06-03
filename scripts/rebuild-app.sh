#!/usr/bin/env bash
# Rebuild Memoria.app from current source and reinstall it to /Applications
# (which is what your Dock icon points at), then relaunch.
#
#   pnpm rebuild-app      (or)   bash scripts/rebuild-app.sh
#
# The dev flow (vite + tauri dev) updates live; the installed .app is a snapshot,
# so run this whenever you want the Dock app to pick up code changes.
set -euo pipefail

cd "$(dirname "$0")/.."
APP_SRC="src-tauri/target/debug/bundle/macos/Memoria.app"
APP_DEST="/Applications/Memoria.app"

echo "▸ bundling mcp-server…"
node scripts/bundle-mcp-server.mjs

echo "▸ building frontend…"
./node_modules/.bin/vite build

echo "▸ bundling Memoria.app (debug)…"
./node_modules/.bin/tauri build --debug \
  --config '{"build":{"beforeBuildCommand":""},"bundle":{"targets":["app"],"createUpdaterArtifacts":false}}'

echo "▸ quitting any running Memoria…"
osascript -e 'tell application "Memoria" to quit' 2>/dev/null || true
sleep 1
pkill -f "Memoria.app/Contents/MacOS" 2>/dev/null || true
sleep 1

echo "▸ reinstalling to ${APP_DEST}…"
rm -rf "$APP_DEST"
cp -R "$APP_SRC" "$APP_DEST"

echo "▸ launching…"
open "$APP_DEST"
echo "✓ Memoria rebuilt and reinstalled. Dock icon now runs the latest build."
