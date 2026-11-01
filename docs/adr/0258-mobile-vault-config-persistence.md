# ADR-0258: Mobile Vault-Scoped Config Persistence

## Status

Accepted

## Context

Desktop Memoria stores some per-vault UI configuration locally by vault path. Primary note-list display properties for All Notes and Inbox are part of that contract: changing them should survive reloads without becoming markdown files in the vault.

The mobile foundation already had reducer state for primary note-list property overrides, but the edit produced no repository writes. That was acceptable for the static UI phase and wrong for real editing parity, because native snapshots rebuilt from the Expo filesystem lost the setting.

## Decision

Add a mobile vault-config write contract to the existing workspace repository boundary.

`mobileWorkspaceEditing.ts` now emits `saveVaultConfig` write plans when primary note-list display properties change. `localVaultSnapshot.ts` accepts a mobile vault config and derives `noteListPropertyOverrides` from it, while `fileSystemWorkspaceRepository.ts` delegates storage to its `WorkspaceFileSystem` adapter. The Expo adapter stores the config outside the vault file list, keyed by the selected vault root URI, preserving the desktop distinction between vault content and installation-local vault UI settings.

## Consequences

- Mobile primary note-list display properties now round-trip through native reloads.
- The reducer remains the only place that owns optimistic workspace state and write planning.
- The repository boundary can later extend the same config object for other desktop vault-config fields without changing visual components.
- Config storage is installation-local for now, matching the desktop implementation this mobile foundation is copying.
