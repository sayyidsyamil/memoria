# 0237: Completed mobile conflict-backup retention

Date: 2026-10-18
Status: Accepted for the mobile foundation branch
Platform: mobile

## Context

iOS linked-folder conflict resolution retains private local, remote and merged
snapshots outside the vault. They allow interrupted publication to resume but
previously accumulated indefinitely after successful resolutions. Removing them
by directory age alone could destroy unresolved or unrecognized recovery data.

## Decision

After saving the resolved baseline, record a versioned completion marker in that
resolution's private UUID directory, before removing its publication journal.
A missing or unwritable marker never fails an otherwise successful resolution.
An interruption between marker publication and journal removal remains pending
and protected until normal recovery finishes.

After each successful finish, retain the latest three recognized completions and
every completion from the last seven days. Prune only older completions beyond
that floor, under the existing workspace mutation lock. Candidate identity,
schema, time and expected top-level layout must validate; reject symlinks before
deletion. Cleanup failures are best-effort and do not fail the resolved sync.

Never prune the active journal's directory, superseded resolutions, old unmarked
backups, malformed markers, future timestamps or unknown content. A corrupt
pending journal blocks all cleanup. No user vault, provider file, Git object or
original document is a cleanup target. No new dependency or preference is added.

## Consequences

New successful resolutions have bounded historical retention after the grace
period. This is not a total storage quota: unresolved, legacy and unrecognized
data is deliberately retained, and many resolutions within seven days can still
consume space. No claim is made that this provides backup restoration UI or
whole mixed write-plan recovery.

Foundation regressions execute on macOS and both iOS simulator targets, using
only disposable filesystem roots. They cover pruning, the three-completion floor,
the grace period, interrupted completion, corrupt journals/markers, symlinks,
idempotence and failure to write a completion marker.
