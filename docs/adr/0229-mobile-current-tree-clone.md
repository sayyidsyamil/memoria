---
type: ADR
id: "0229"
title: "Current-tree mobile clone with merge-driven history retrieval"
status: active
date: 2026-10-17
---

Platform: mobile

## Context

The mobile Git engine indexes received packs in JavaScript. A native fixture with
3,000 current files and 256 MiB of deleted attachment revisions completed, but
reached approximately 2 GiB resident memory and a seven-second JavaScript stall.
Those historical revisions are not necessary to open or edit the current vault.
Avoiding duplicate buffers helps, but does not bound a complete-history clone.

## Decision

**Clone the complete current tree at depth one, and retrieve older ancestors only
when synchronization needs them to establish a common merge base.** Use the
existing isomorphic-git shallow-clone and relative-deepening APIs. Do not omit
current files, rewrite remote history, or truncate existing full working copies.

Normal edits, fast-forwards, and divergence after the initial clone share its
boundary commit and require no older history. If a remote history rewrite moves
the common ancestor behind that boundary, fetch each shallow boundary OID with
16 additional generations per request, then check the merge base again. Explicit
OID requests retain access to the original local ancestry instead of deepening
only the newly rewritten remote branch. Cancellation is checked at every request.

The existing checkpoint, conflict detection, recoverable checkout, and non-forced
push contracts remain unchanged. If the server no longer has or permits fetching
the required ancestors, or deepening makes no progress, fail without replacing
the working tree or advancing the local branch. Previously saved local commits
remain available. Do not guess a merge base or merge unrelated histories.

## Options considered

- Complete history on every clone: simplest, but unnecessarily imports deleted
  binary history and exceeded reasonable native memory and responsiveness.
- Depth-one clone without deepening: small initial transfer, but cannot correctly
  merge older rewritten histories. Rejected.
- New native Git dependency: may ultimately improve pack streaming, but would
  introduce a second platform-specific engine and requires a separate evaluation.

## Consequences

Initial clones contain every current tracked file and are independent of the
size of removed attachment history. Local historical operations can only see
downloaded ancestors until a sync deepens them. A large current tree, a single
large blob, or history deepening can still consume substantial memory; this is
not a general streaming-pack or physical-device crash certification.

Tests use disposable smart-HTTP repositories for shallow clone, ordinary merge
and push, rewritten ancestry, and unavailable-history preservation. Native
release-mode probes measure clone, push, pull, and event-loop stalls on both iOS
form factors. Fixture Git processes disable automatic maintenance locally and
limit pack workers, without changing global or user-vault Git configuration.

References: [clone](https://isomorphic-git.org/docs/en/clone),
[fetch](https://isomorphic-git.org/docs/en/fetch). Retains ADR 0218 and ADR 0201.
