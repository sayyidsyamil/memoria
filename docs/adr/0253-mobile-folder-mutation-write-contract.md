# ADR-0253: Mobile folder mutation write contract

## Status

Accepted

## Context

The Expo mobile workspace reducer already handled note edits, saved Views, Type metadata/schema edits, note folder moves, and note filename renames. Folder navigation existed in the sidebar, but mobile could not create, rename, or delete folders with the same desktop semantics. Deriving the folder tree only from note paths was also insufficient: an empty folder created on iPad would disappear from the next snapshot because no note path referenced it.

Folder rename could not be represented as delete-plus-save note writes without risking data loss and without matching the desktop model, where a folder operation is a filesystem directory mutation and notes inside the subtree keep their content unless path-based wikilinks need retargeting.

## Decision

Mobile snapshots now carry explicit `folderPaths` in addition to note paths. `localVaultSnapshot.ts` accepts scanned file entries plus folder paths, and `mobileWorkspaceFolders.ts` owns shared folder path normalization, portable name validation, subtree matching, and folder tree derivation.

`mobileWorkspaceEditing.ts` supports folder create, rename, and delete edits. Folder creation adds an explicit folder path and emits `createFolder`. Folder deletion removes the subtree from snapshot notes/folder paths and emits `deleteFolder`. Folder rename retargets notes in the renamed subtree, rewrites affected path-based wikilinks, and emits `renameFolder` plus only the note content writes required by those wikilink rewrites.

The mobile repository boundary persists those write plans as directory operations in native Expo mode and as deterministic host write-log operations in browser QA mode. Visual components continue to receive callbacks and snapshots rather than importing filesystem APIs directly.

## Consequences

- Empty folders remain visible in mobile snapshots and sidebar navigation.
- Native Expo testing exercises real directory create/delete/move behavior through `expo-file-system`.
- Folder rename stays a directory mutation, preserving desktop parity and avoiding a delete/recreate approximation.
- Host and Playwright QA can assert folder writes without touching the developer's vault.
- Git sync remains out of scope for the current mobile foundation branch.
