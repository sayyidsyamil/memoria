---
type: ADR
id: "0295"
title: "Mobile note reads during linked-folder sync"
status: active
date: 2026-10-25
Platform: mobile
---

## Context

Mobile linked-folder sync must keep writes and the provider merge serialized.
Holding note reads behind that full-vault operation makes an open note wait for
the entire sync, even though its app-managed working-copy file can be read
independently. Native sync atomically replaces changed files in that copy.

## Decision

Keep writes and recovery on the existing per-root operation queue. Mark only
the native linked-folder merge window. During that window, a selected-note read
may bypass the queue and read its file asynchronously from the app-managed
copy. Sync flushes queued writes and recovery before entering the window, so
the read skips synchronous recovery only while the marker is active. Writes
submitted during sync remain queued until the merge finishes.

## Consequences

An open note can show the complete pre-merge or post-replacement bytes without
waiting for unrelated files to sync. This is a per-file read, not a consistent
multi-file snapshot. Outside the linked-sync window, disk-authoritative reads
still wait for queued writes and run recovery before enabling edits. No native
API, write authority, or provider synchronization rule changes.
