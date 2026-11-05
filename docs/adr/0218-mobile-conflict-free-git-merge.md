# 0218: Merge mobile Git histories without rewriting commits

Date: 2026-10-13
Status: Accepted for the mobile foundation branch
Supersedes ADR 0194's stop-on-all-divergence policy; retains ADR 0201 recovery.

## Decision

Use isomorphic-git's three-way merge for divergent histories with one common
ancestor. Prefer merge commits to automatic rebase: both histories and commit
identities survive, and no forced push or hidden history rewrite is necessary.

Checkpoint local edits first. Build merged objects with `noUpdateBranch` and
`abortOnConflict`. Validate simultaneously changed blobs as lossless UTF-8 without
NUL bytes before invoking the library's text merger. Genuine conflicts, binary
conflicts, unrelated histories and unsupported merge bases preserve both copies
and report divergence. Do not write conflict markers into user documents.

Publish a successful merge through the existing checkout-intent journal. The
merge commit descends from the previous local HEAD, so the existing recoverable
fast-forward publication contract applies unchanged. Never advance the branch
before all working-copy writes complete.

If push loses a race to another device, fetch and integrate again, with at most
three attempts per sync. Never force. Failed network or repeated push rejection
leaves local commits available for the next attempt. Accumulate the workspace
change result across retries so the editor cannot resume stale document bytes.

## Verification

Disposable real Git repositories cover separate files, nonoverlapping edits in
one Markdown document, conflict preservation, invalid UTF-8 and binary data,
delete-versus-edit, interrupted checkout, HTTP merge/push and bounded push races.

Reference: https://isomorphic-git.org/docs/en/merge
