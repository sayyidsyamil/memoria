# ADR-0236: Cooperative Mobile Workspace Preparation

Platform: mobile

## Status

Accepted.

## Context

The native launch index in ADR-0193 removes thousands of bridge calls, but parsing
the fresh 6,000-file index still blocked JavaScript for roughly 700 milliseconds.
An async function alone does not allow input or drawing to run during that work.
Reusing stale note bodies, type definitions or saved views would also make a
startup optimization an unsafe source of future writes.

## Decision

Keep one snapshot algorithm. Its internal iterator yields between document,
summary, editable-preview and saved-view conversions. The synchronous API drains
that iterator directly; native selection preparation runs it through the existing
sixteen-millisecond task runner from ADR-0209. Cancellation rejects obsolete loads
without publishing partial results.

Prepare before publishing restored, selected or newly imported vaults, while the
existing restore/save barrier prevents editing. A weak, single-use handoff avoids
repeating snapshot construction during the initial render. It is keyed by the
exact launch-index object and file/directory array identities, plus vault identity
and normalized configuration. Every lookup removes the handoff, including a
mismatch. Recovery that discards the launch index cannot consume the prepared
snapshot. Subsequent reads retain the existing repository behavior.
The selection controller retains an index only while that fresh handoff exists;
ordinary sync refreshes still discard previously consumed indexes.

This adds no persistent index, timestamp-based content reuse, filesystem watcher,
background snapshot replacement or second storage authority. ADR-0193's index
freshness contract and the existing write/recovery queues remain in effect.

## Consequences

- Type definitions, views, relationships, frontmatter and binary metadata must
  remain identical between synchronous and cooperative builds.
- The work budget is cooperative, not a latency guarantee: one large document or
  a final sidebar/sort operation can still exceed it. Native timer-delay and
  throughput measurements on the same disposable fixture remain required.
- The handoff is not the persistent cold-start cache requested in TOL-72. That
  work and whole mixed write-plan recovery remain separate open requirements.
- No user vault files or cache files inside a vault are created by preparation.
