# 0271: Mobile Revisioned Pending-Note Indicators

Date: 2026-10-20
Status: Accepted
Platform: mobile

## Context

The sidebar sync pill describes vault-wide state, but users also need to identify
notes with locally written changes. Sync releases the editor barrier during
network waits, so clearing all pending paths after success can hide newer edits.

## Decision

Extend the installation-local sync ledger with monotonically revisioned paths.
Actual workspace writes publish dirty paths; moves and renames include both
endpoints. Git and linked-folder checkpoints capture the pending revision under
their existing local-write barrier and acknowledge only those revisions after
success. Later edits, including edits to the same path, retain their indicator.
Failed operations do not acknowledge pending paths.

Render a small yellow dot before matching note titles for the active connected
vault only. Folder renames also match descendants. Purely local vaults do not
imply an unavailable remote destination. Existing ledgers without the optional
fields remain readable, and malformed new fields use existing ledger recovery.

## Consequences

Pending dots survive restarts without storing note contents. They represent
app-observed changes, not a complete Git status calculation. Fresh Git/content
verification remains mandatory; these paths never authorize checkout, skip disk
reads, or assert that iCloud has completed cross-device delivery. This passive
status display emits no additional analytics event because it adds no user action.
