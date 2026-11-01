# ADR-0192: Managed Local iOS Vault

## Status

Accepted; supersedes ADR-0191.

## Context

Memoria needs to reopen one editable vault after an iPad app restart. The iOS
document picker grants access to a selected directory for the current process,
but iOS does not support the macOS security-scoped bookmark options required to
reacquire arbitrary external-folder access after relaunch. Persisting the URL or
a regular bookmark therefore works only until the process terminates.

## Decision

Selecting a vault imports it into an app-managed `Documents/Memoria Vault`
directory. The local `MemoriaWorkspaceAccess` Expo module copies the selected
folder while picker access is active, atomically replaces the previous managed
vault only after the copy succeeds, and stores the original folder name for UI
identity. Startup always restores this managed directory.

The app exposes its Documents directory through the iOS Files app. Launch scope
is one local, offline, editable vault. External-folder synchronization, Git
sync, multiple vaults, and conflict resolution remain outside this boundary.

## Consequences

- Cold launches have durable read/write access without relying on expired picker
  permissions.
- A failed or interrupted import preserves the previous managed vault.
- Reopening another vault replaces the managed copy after a successful import.
- Changes are local to Memoria's managed copy until a later export or sync layer
  is implemented.
- Expo Go remains suitable for UI preview, while import persistence requires the
  custom development or production build containing the local module.
