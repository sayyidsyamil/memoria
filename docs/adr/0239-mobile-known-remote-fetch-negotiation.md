---
type: ADR
id: "0239"
title: "Negotiate mobile fetches from the known remote tip"
status: active
date: 2026-10-18
---

Platform: mobile

## Context

Mobile sync checkpoints local edits before fetching. The installed Git library's
single-branch fetch advertises only its selected local reference as a `have`.
After checkpointing, that reference points to an unpublished commit the server
does not know. A real smart-HTTP regression downloaded 81,232 bytes again from an
81,288-byte unchanged vault. Native phase measurements also show a seven-second
pre-push fetch on the 6,000-file fixture.

## Decision

**For ordinary same-name origin tracking, negotiate from the last-known remote
reference and explicitly select the remote branch.** Continue using the public
isomorphic-git fetch API; do not add a Git implementation or modify dependencies.

Use `refs/remotes/origin/<branch>` as the local negotiation reference and
`refs/heads/<branch>` as the remote selection. Keep the actual local branch and
checkpoint unchanged. Nonstandard configured remotes or upstream mappings retain
the library's existing selection behavior. Explicit shallow-boundary deepening
requests remain unchanged.

## Options Considered

- Known origin tracking reference: avoids advertising an unpublished commit while
  retaining single-branch transfer and existing object validation.
- Fetch all branches to advertise more references: rejected because unrelated
  branches can import large histories, undermining ADR 0229.
- Temporary negotiation branches, custom protocol requests or a dependency fork:
  rejected as unnecessary additional state or maintenance.

## Consequences

Normal local edits avoid transferring the unchanged vault before push. A missing
tracking reference or unavailable object still falls back to ordinary server
negotiation; the library owns reference/object checks and pack processing. A
rewritten remote may legitimately require more data. This does not eliminate
full-content staging, clone pack cost or merge-driven history retrieval.

Keep authentication, cancellation, editor/save barriers, recoverable checkout
and non-forced push intact. Verify real request packets, transfer sizes, branch
selection, preserved content and native iPhone/iPad behavior before release.

References: [fetch](https://isomorphic-git.org/docs/en/fetch),
[ADR 0229](0229-mobile-current-tree-clone.md).
