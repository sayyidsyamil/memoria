# ADR-0274: Preserve the Task Budget Across Mobile Native Reads

Platform: mobile

## Status

Accepted. Supersedes only ADR 0209's native-read budget renewal rule.

## Context

A native promise completing does not establish that JavaScript input or timers
have run. Renewing the filesystem budget on every quick byte/directory read can
allow a long sequence of native reads and JavaScript continuations to evade the
existing sixteen-millisecond yield check. A deterministic 6,000-read regression
demonstrates the input callback running only after the whole sequence finishes.

## Decision

Run native reads through the filesystem instance's existing task budget. Only
the shared zero-delay timer renews that budget. Promise completion and rejection
do not reset it. Preserve the independent transport-progress budget, concurrent
timer coalescing, byte views, error propagation, and per-vault serialization.

This changes scheduling only. Recovery, fresh-content verification, cache
authority, editor barriers, native APIs and user vault contents are unchanged.

## Consequences

- Input can run between quick reads once the cooperative budget is exhausted.
- Genuine asynchronous IO may be followed by an extra timer; compare throughput
  and scheduling delays on the same generated native fixture before release.
- Individual large native/library operations are still not preemptible. This is
  not full background reload or permission to edit source-free cached previews.
- Native iPhone/iPad measurements and automated data-preservation regressions
  remain separate from rendered-frame and create-during-reload acceptance.
