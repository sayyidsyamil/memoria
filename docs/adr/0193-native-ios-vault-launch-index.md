# ADR-0193: Native iOS Vault Launch Index

## Status

Accepted.

## Context

Restoring a large app-managed iOS vault through `expo-file-system` required one
JavaScript-to-native call per directory and file. Laputa has thousands of notes,
so startup spent tens of seconds crossing the React Native bridge before the
pure snapshot builder could render the workspace.

## Decision

The local `MemoriaWorkspaceAccess` Expo module enumerates the managed vault on a
native asynchronous function and returns one JSON launch index containing folder
paths and file metadata/content. The filesystem repository accepts that index as
an optional input to its existing pure snapshot builder.

The index is a launch optimization, not a second persistence model. Note
hydration, edits, and structural writes continue through the filesystem
repository and its existing write plans. Browser and Expo Go paths retain the
ordinary `expo-file-system` traversal fallback.

## Consequences

- Large-vault startup crosses the native bridge once instead of thousands of
  times.
- The snapshot parser and workspace semantics remain shared with host-vault and
  filesystem-backed QA paths.
- The serialized index temporarily occupies native and JavaScript memory during
  startup; launch performance and memory should remain part of native iPad QA.
- A future live external-sync layer must invalidate or replace the launch index
  rather than treating it as an authoritative long-lived cache.
