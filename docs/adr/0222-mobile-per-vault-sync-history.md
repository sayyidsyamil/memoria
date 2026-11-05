# 0222: Per-vault mobile sync history

Date: 2026-10-13
Status: Accepted for the mobile foundation branch

## Decision

Persist installation-local sync history keyed by managed vault ID, outside user
content, in `.memoria-mobile-config/sync-history.json`. Keep status, last successful
sync time, last local commit ID, operation phase, and a bounded error category.
Never store tokens, repository URLs, provider bookmarks, paths or note content.

Use validated pending-file publication and backup recovery, matching the existing
settings/catalog boundary. Serialize updates; a late restore cannot replace new
in-memory events. Restore interrupted operations as pending, never running or
successful. Failed history persistence is visible but does not discard edits.

Git checkpoints, remote sync and provider writeback remain distinct. A successful
push records its time but leaves status pending if typing continued after the
last checkpoint. Linked-folder success confirms provider writeback only, not
iCloud cross-device delivery. Switching vaults restores that vault's own history.

## Consequences

The history is observational metadata, not a replacement for Git or filesystem
reconciliation. Last success describes an observed operation, not a guarantee
that another device has not changed the remote since then. No network access is
needed to display history, and losing this file does not lose vault content.
