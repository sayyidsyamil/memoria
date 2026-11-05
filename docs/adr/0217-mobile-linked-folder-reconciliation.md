# 0217: Linked Files-provider folders with a local working copy

Status: Accepted. Supersedes the copy-only choice in ADR 0192 for new iOS folder
selections; builds on ADRs 0198 and 0216. Existing imports remain unlinked copies.

## Context

Users need edits made on iPad to reach the folder chosen in Files, including
iCloud Drive, without putting provider latency on the editor's read/save path.
Apple supports persistent directory grants with minimal bookmarks on iOS.
Access requires balanced security scopes and coordinated file operations.

## Decision

Retain the existing app-owned working copy and durable save barrier. New iOS
folder selections persist a minimal bookmark and SHA-256 baseline separately in
Application Support, keyed by the working copy's container-relative path. No
bookmark, provider path or sync state is stored in user content or analytics.

Reconcile baseline, local and provider trees under NSFileCoordinator and the
native mutation lock. Equal versions converge; changes on only one side copy to
the other. Different edits, delete-versus-edit and parent/child collisions stop
without choosing a winner. Directory removal requires emptiness. Reject symbolic
links and traversal. Never copy or mutate `.git`, `node_modules` or `.DS_Store`.
Include binary attachments and other hidden vault metadata.

Advance the baseline only after both sides complete. An interrupted pass can be
retried because already-equal entries converge against the previous baseline.
The working copy remains available when a provider or permission is unavailable.
Sync is automatic after five seconds of foreground inactivity, on foreground
return, and during a one-minute foreground poll; an explicit Sync action is also
available. Flush editor drafts and pending writes before reconciliation. Never
remount the workspace for a confirmed no-change/outbound-only result.

"Saved to folder" means coordinated provider writes completed, not that iCloud
has delivered them to another device. iCloud controls that transport and its
availability. Background delivery while Memoria is suspended is not promised.
Android remains copy-only until an equivalent persisted SAF adapter is verified.
No custom iCloud entitlement or network protocol is needed for Files access.

## Consequences

This duplicates vault storage and hashes content during reconciliation, but
preserves the current fast/offline repository and avoids unchecked external Expo
filesystem access. Conflict resolution is conservative: both versions remain in
their respective folders; no automatic merge or destructive winner selection.
Existing copies must be explicitly linked by selecting their original folder
again. Forgetting a vault stops its automatic sync and never deletes user files.

Reference: [Apple: Providing access to directories](https://developer.apple.com/documentation/uikit/providing-access-to-directories).
