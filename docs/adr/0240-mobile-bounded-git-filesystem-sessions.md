---
type: ADR
id: "0240"
title: "Bounded mobile Git filesystem sessions"
status: active
date: 2026-10-18
---

Platform: mobile

## Context

Native sampling of the 6,000-file Git fixture identifies repeated public Expo
File construction and URI normalization as substantial work. Production creates
a new filesystem adapter for each Git connection, discarding its reusable path
handles. The existing 8,192-entry handle cache also thrashes when repeatedly
scanning a representative 9,000-file vault.

## Decision

**Reuse the filesystem adapter for only the most recently used managed Git root.**
Key the session by the exact root URI and replace it when another root is used.
Do not replace a working session with a failed factory result. A filesystem session
contains only the existing public Expo path handles and cooperative work budget.

Bound each adapter's URI, File and Directory handle cache at 16,384 entries.
This covers the measured vault size while retaining a fixed upper bound. Larger
working sets remain correct, but may need to reconstruct evicted handles.

Every existence, type, metadata and content read remains fresh. Never cache file
bytes, hashes, timestamps, native authorization, Git indexes/objects or transport
credentials between operations. Keep independent Git operation caches, root
validation, save/checkout barriers, journaling and non-forced writes unchanged.
Handles are not moved or renamed through this adapter, so their URI stays fixed.

Use the same getter in the native round-trip probe and production; a benchmark
must not exercise a different adapter lifetime than the app.

## Alternatives

- Reconstruct adapters for every operation: loses reusable handles and repeats
  expensive public constructor normalization.
- Retain two recent roots: rejected after native measurements showed unnecessary
  memory retention. Only one vault is active in the UI; switching roots may
  reconstruct the adapter.
- Retain unbounded roots/handles: rejected because large-vault memory is already
  a release concern.
- Cache filesystem state or bypass Expo's constructor validation: rejected because
  stale data or weakened checks are not acceptable performance shortcuts.

## Verification

Regressions cover root isolation, single-root retention, factory retry, fresh reads and
bounded retention beyond 16,384 paths. Native 9,000-file before/after timing and
resident-memory probes must pass on iPhone and iPad before shipping. Existing
working-copy, external-edit, byte-preservation and recoverable-checkout checks
remain required. Profiling/sampling overhead is not a baseline timing result.
