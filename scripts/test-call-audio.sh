#!/bin/sh
# Native lifecycle regression: no audio playback, capture or language models.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
temporary=$(mktemp -d "${TMPDIR:-/tmp}/memoria-call-audio-tests.XXXXXX")
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
cat "$root/src-tauri/native/call-audio/main.swift" \
    "$root/src-tauri/native/call-audio/lifecycle-tests.swift" > "$temporary/main.swift"
xcrun --sdk macosx swiftc -O -swift-version 5 -D MEMORIA_CALL_AUDIO_TESTS \
    "$temporary/main.swift" -o "$temporary/lifecycle-tests"
"$temporary/lifecycle-tests"
"$temporary/lifecycle-tests" --verbose
