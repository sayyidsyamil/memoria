#!/bin/zsh
# Release build for a tagged UAT build: refuses a dirty tree or telemetry keys, builds the app and
# its disk image, checks the bundle and dist/, and writes docs/RELEASE_RECORD.md (commit it with
# the tag). The app's Python runtimes and models are not inside the bundle: the target account
# needs the shared install (scripts/install-shared-runtime.sh) or the developer runtimes.
#   scripts/build-release.sh
set -eu
setopt pipefail
repo=${0:A:h}/..
cd $repo

[[ -z "$(git status --porcelain)" ]] || { print "Refusing: the working tree is not clean."; git status --short | head; exit 1; }
for key in VITE_SENTRY_DSN SENTRY_DSN VITE_POSTHOG_KEY POSTHOG_KEY; do
  [[ -z ${(P)key:-} ]] || { print "Refusing: $key is set; release builds carry no telemetry keys."; exit 1; }
done
for file in .env .env.local .env.production .env.production.local; do
  [[ ! -f $file ]] || ! grep -qE '^(VITE_SENTRY_DSN|SENTRY_DSN|VITE_POSTHOG_KEY)=.+' $file \
    || { print "Refusing: $file sets a telemetry key."; exit 1; }
done

commit=$(git rev-parse HEAD)
version=$(/opt/homebrew/bin/python3.11 -c "import json; print(json.load(open('src-tauri/tauri.conf.json'))['version'])")
started=$(date '+%Y-%m-%d %H:%M %z')
# Bytecode left by tests and research runs is not part of the app (and is regenerated nowhere in the bundle).
find src-tauri/resources/memory -name __pycache__ -type d -prune -exec rm -rf {} +
# CI makes the bundler skip the Finder layout step of the disk image (no window is opened).
CI=true pnpm tauri build

bundle=src-tauri/target/release/bundle
app=$bundle/macos/Memoria.app
dmg=$(print -r -- $bundle/dmg/Memoria_${version}_*.dmg(N[1]))
[[ -d $app && -f $dmg ]] || { print "Build output missing: $app / $dmg"; exit 1; }

resources=$app/Contents/Resources
for required in memory/engine.py memory/live_assistance.py memory/memoria_engine; do
  [[ -e $resources/$required ]] || { print "Bundle check failed: $required missing"; exit 1; }
done
[[ -z "$(find $resources -name __pycache__ -print -quit)" ]] || { print "Bundle check failed: __pycache__ in the bundle"; exit 1; }
if grep -rqE 'ingest(\.[a-z]+)?\.sentry\.io|phc_[A-Za-z0-9]{20,}' dist; then
  print "dist/ scan failed: a telemetry key is embedded"; exit 1
fi

dmg_sha=$(shasum -a 256 $dmg | cut -d' ' -f1)
bin_sha=$(shasum -a 256 $app/Contents/MacOS/memoria | cut -d' ' -f1)
dmg_size=$(du -h $dmg | cut -f1)
cat > docs/RELEASE_RECORD.md <<EOF
# Release record

| | |
|---|---|
| Version | $version |
| Built on | $started |
| Git commit | \`$commit\` |
| Disk image | \`${dmg:t}\` ($dmg_size) |
| Disk image SHA-256 | \`$dmg_sha\` |
| Machine | $(sysctl -n machdep.cpu.brand_string), $(sw_vers -productName) $(sw_vers -productVersion), $(uname -m), $(( $(sysctl -n hw.memsize) / 1073741824 )) GB |
| rustc | $(rustc --version) |
| cargo | $(cargo --version) |
| node | $(node --version) |
| pnpm | $(pnpm --version) |
| tauri-cli | $(pnpm -s tauri --version 2>/dev/null | tail -1) |
| Telemetry keys | none in the environment or .env files; \`dist/\` scan clean |
| Bundle check | memory/engine.py, memory/live_assistance.py, memory/memoria_engine present; no __pycache__ |

App binary SHA-256 (\`Memoria.app/Contents/MacOS\`):

\`\`\`
$bin_sha  memoria
\`\`\`

The build is ad-hoc signed and not notarised, so on another Mac the first open needs right-click >
Open. It does not contain the Python runtimes or the models: on the build Mac they come from the
developer runtimes or the shared install in \`/Users/Shared/Memoria\` (\`scripts/install-shared-runtime.sh\`,
any account of this Mac); \`scripts/uat/memoria-doctor.sh\` checks an account before use.
EOF
print "Release $version from $commit: $dmg ($dmg_sha). Commit docs/RELEASE_RECORD.md and tag it."
