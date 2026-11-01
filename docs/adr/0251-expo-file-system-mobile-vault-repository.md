# ADR-0251: Expo FileSystem Mobile Vault Repository

## Status

Accepted

## Context

The mobile UI foundation now exercises real note creation, body/title edits, scalar properties, relationships, wikilinks, saved views, type sections, and folder navigation through an in-process reducer. The previous repository boundary emitted write plans but did not write to an on-device vault, so Expo/iPad testing could verify UI behavior without proving local markdown persistence.

Memoria still treats markdown files plus YAML frontmatter as the source of truth. The mobile app needs to preserve that rule while staying compatible with Expo SDK 54 and Expo Go during the tablet preview phase.

## Decision

Use `expo-file-system` as the SDK-54-compatible native filesystem adapter for mobile vault reads and writes.

The mobile app keeps filesystem access behind `ReadOnlyWorkspaceRepository`. Fixture and host-injected large-vault QA remain available for deterministic web tests. Native vault mode is explicit (`source=native-vault`) and routes through a filesystem-backed repository that:

- scans markdown files and `views/*.yml` with the same `localVaultSnapshot.ts` parser used by large-vault QA;
- lazily hydrates metadata-only notes by relative vault path;
- persists reducer write plans (`createNote` / `saveNote`) back to relative markdown paths;
- rejects absolute paths, URI paths, and parent traversal before writing.

The Expo adapter defaults to a sandboxed `Memoria Vault` directory under `Paths.document`, while `vaultUri` / `EXPO_PUBLIC_MEMORIA_NATIVE_VAULT_URI` can point to another Expo-accessible directory for development.

## Consequences

- Mobile editing can now be verified against actual Expo/iOS filesystem writes without putting filesystem calls into visual components.
- The pure parser/reducer path remains shared by fixture, host-vault QA, and native vault mode.
- Expo Go compatibility is preserved because the dependency is pinned to SDK 54's `expo-file-system` line.
- Directory picking and durable user-selected vault permissions remain future work; iOS picked-directory access is session-scoped in Expo Go.
- Git sync, AI, and saved View mutation remain outside this repository slice.
