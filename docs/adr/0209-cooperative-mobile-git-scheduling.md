---
type: ADR
id: "0209"
title: "Cooperative mobile Git scheduling"
status: active
date: 2026-10-10
---

## Context

The optimized native 6,000-file Git fixture exposed a 9,112 ms JavaScript timer
delay. Async functions around synchronous native metadata and file mutations
still return through microtasks; awaiting them does not let input callbacks run.
The Git library also explicitly awaits progress callbacks during pack processing.

## Decision

Use a small per-instance task-yield function at the Expo adapter's synchronous
metadata/mutation boundaries and the library's existing progress callback.
After a sixteen-millisecond work budget, schedule a zero-delay timer. Concurrent
requests share that pending timer; the next budget starts when it actually fires.
Each resumed caller rechecks the budget and performs its synchronous work in that
same continuation. Checking before a separate awaiting caller resumes would let
a concurrent burst pass the budget check before any of its work is accounted for.
Existing asynchronous byte/directory reads renew the budget when they complete,
avoiding a redundant timer after the native event loop already yielded. This
reset is not used for arbitrary JavaScript promises.

No metadata/content cache, alternate Git implementation, worker dependency, or
mutation queue is added. Per-vault serialization, complete-content staging for
rapid edits, checkout recovery, and editor save barriers remain unchanged.

## Consequences

- This is cooperative scheduling, not preemption or a sixteen-millisecond latency
  guarantee. One library/native operation or a large file can still exceed it.
- Measure timer delay and throughput on the same optimized native fixture before
  accepting an improvement. A fast unit test cannot establish responsiveness.
- Tests check real task boundaries, concurrent timer coalescing, fresh metadata
  after resuming, error propagation, and ordinary Git round trips.
- Physical-device and Android measurements remain separate release work.
