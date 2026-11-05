type: ADR
id: "0285"
title: "Disk-authoritative mobile note editing and index reconciliation"
status: active
date: 2026-10-24
Platform: mobile
---

## Context

Mobile startup may display a cached workspace snapshot while the native filesystem index is refreshed. Cached note text can be stale, and user writes must not wait behind a full-vault scan or be replaced by older scan results.

## Decision

Keep cached previews read-only until an exact disk read completes; apply differing disk content before enabling edits. Persist user writes immediately through the normal write path. Index scans remain read-only and run outside the write queue. Track paths written during an index pass and repeat the scan until a pass completes without concurrent writes.

## Consequences

Users can read cached metadata immediately, but existing notes are not editable until disk validation finishes. Concurrent writes are not blocked by indexing, and the final published index reflects a stable disk pass. Continuous writes may delay index publication while leaving normal editing available.
