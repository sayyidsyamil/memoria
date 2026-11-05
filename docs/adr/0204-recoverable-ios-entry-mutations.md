# 0204: Recoverable standalone iOS moves and deletions

Date: 2026-10-10
Status: Accepted for the mobile foundation branch

## Context

ADR 0203 protects published text saves, but folder removal still recursively
deleted the visible tree and moves had no durable intent. A process interruption
could leave a partial folder deletion. Recovery could also complete a failed move
before the JavaScript queue retried it, making the retry fail on its missing source.

## Decision

- Extend the existing native workspace boundary, not component or reducer APIs.
  Text saves and entry mutations share a recursive lock, root checks, and recovery
  before reads, subsequent mutations, and Git sync.
- Atomically publish one entry operation per root outside the vault. Record its
  relative source/destination, expected kind, operation UUID, and content/tree
  fingerprint. Hash file bytes in bounded chunks; include every child name and
  kind in directory fingerprints. Reject symlinks and reserved Git paths.
- Coordinate both paths and use Darwin's exclusive same-volume rename. A late
  destination collision cannot overwrite an existing file. Cross-volume moves
  fail rather than degrade into copy/delete.
- Delete by renaming the entire entry to a private quarantine path. The visible
  tree is present or absent, never partially recursively deleted. Only after
  publication of a completion receipt and removal of the pending journal may
  quarantine cleanup run. Interrupted cleanup resumes independently.
- Replay checks source and destination fingerprints. An already relocated entry
  is recognized; changed bytes or collisions preserve both paths and pending
  intent instead of overwriting them.
- Keep one bounded last-completion receipt per root. The bridge retains a
  native-generated operation UUID after failure and clears it after success.
  An exact retry can succeed after read-side recovery without repeating a move;
  a new command with identical paths gets a different UUID and is not mistaken
  for that retry. The receipt never authorizes replacing an existing destination.

## Limits

This protects one structural operation, not an entire reducer plan containing a
move plus multiple backlink/configuration rewrites. Full write-plan transactions
remain separate work. Quarantine is transient cleanup storage, not a Trash UI or
durable undo history. Existing undo semantics are unchanged.

Only app-managed standalone iOS roots use this backend. Expo Go and Android retain
their existing adapter; no live file-provider support is implied. No dependency,
UI copy, analytics event, or desktop design change is needed.

## Verification

Real-filesystem tests inject faults before/after publication, relocation, and
commit. Tests cover nested binary changes, path containment, symlinks, Git checkout
exclusion, read-then-retry, and a new command using the same paths. The native
cross-launch harness has an `--entries` mode for actual iPad app termination and
replay of a folder move, quarantined deletion, and externally edited conflict.

The exclusive rename contract is documented in the installed Darwin `rename(2)`
manual and Apple's [volume capability documentation](https://developer.apple.com/documentation/foundation/urlresourcevalues/volumesupportsexclusiverenaming).
