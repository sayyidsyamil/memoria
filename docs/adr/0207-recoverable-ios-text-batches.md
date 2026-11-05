---
type: ADR
id: "0207"
title: "Recoverable standalone iOS text batches"
status: active
date: 2026-10-10
---

## Context

Recovering one published text save does not protect the remaining notes in a
bulk update. An app interruption can lose the in-memory remainder of the write
plan. A generalized transaction layer for moves, deletions, configuration, and
backlink rewrites would substantially expand this change's scope.

## Decision

Extend the existing text journal to version two: one operation identity and an
ordered collection of text entries, each with its path, previous digest, and
intended bytes. Publish the complete plan before the first replacement. Reject
empty, duplicate, ancestor-overlapping, and unsafe paths before publication.

Recovery checks every member before changing any member, then rechecks each
replacement under file coordination. Already intended bytes need no rewrite.
Unexpected external changes retain the whole plan and block further workspace
reads, writes, and Git. Publish a completion receipt for the whole plan before
removing the journal; its entries contain digests, not note bodies.

Single saves use the same engine. Version-one pending saves and completion
receipts remain readable. Older binaries fail closed on version-two records.
The repository integration uses the batch capability only for entirely text
write plans and coalesces repeated paths to their final content. Mixed structural
plans retain their existing individual-operation boundaries.

## Consequences

- This is durable roll-forward for published text batches, not an all-or-nothing
  filesystem transaction. A concurrent external change can leave earlier members
  applied; the retained record prevents silently presenting that as completion.
- The existing per-root queue and native mutation lock remain the serialization
  boundary. No new storage service, dependency, or generic command framework.
- Unsent editor keystrokes, Android/Expo Go persistence, live provider folders,
  and mixed move/backlink plans remain outside this guarantee.
- Real-filesystem fault tests cover interruption, partial replacement, conflicts,
  receipt failures, and old records. The standalone iPad cross-launch proof is
  required when connecting the repository capability.
