---
type: ADR
id: "0235"
title: "Bounded native editor document reads"
status: active
date: 2026-10-18
---

Platform: mobile

## Context

TenTap 1.0.1's native CoreBridge reads use a global subscription table that never
removes callbacks after replies. Repeated autosaves can therefore retain fulfilled
promises and their document snapshots. Adding readiness reads to that same path
would increase the retention. This source-level finding does not establish the
cause of the reported physical-device crashes.

## Decision

**Use a per-editor bounded native CoreBridge adapter for JSON, HTML and text reads,
while retaining TenTap's existing public extension API and wire protocol.**

The adapter removes callbacks and timers before completing replies, expires
unanswered requests after ten seconds, and permits at most 32 simultaneous reads.
It validates reply kinds and content shapes. State, focus and all other CoreBridge
behavior delegate to the pinned SDK unchanged; the generated WebView bundle does
not change.

Unmount cleanup follows the existing final-save cleanup: no new reads are accepted,
but an already-issued final read may finish within its existing bounded deadline.
Effect replay can reactivate the owner without reusing request identifiers.

## Options Considered

- **Public native CoreBridge adapter (chosen):** isolates request lifetimes without
  changing document serialization, vault data, dependencies or WebView code.
- **Delete SDK-private subscription entries:** couples Memoria to private global
  SDK state and can interfere with other editors' requests.
- **Fork or replace TenTap:** disproportionate to this request-lifetime defect.

## Consequences

- Every app-native core document read, including autosave and tool reads, shares a
  bounded owner rather than retaining historical snapshots indefinitely.
- Timeouts and retired-editor reads fail explicitly; existing write preparation,
  draft guards and recovery barriers remain responsible for safe persistence.
- SDK upgrades must verify the three request/reply wire names, native override
  selection, state delegation, and real-device save/focus behavior.
- Revisit the adapter if upstream provides equivalent cleanup and cancellation.
