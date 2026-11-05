---
type: ADR
id: "0234"
title: "Full-content verified selective mobile Git staging"
status: active
date: 2026-10-18
---

Platform: mobile

## Context

Mobile checkpoints recursively add the entire working copy to avoid missing
equal-length edits within a filesystem timestamp tick. This is safe but compresses
every file again and creates loose copies of unchanged packed blobs. Synchronizing
an unchanged large vault therefore performs unnecessary object writes.

## Decision

Retain full-content verification, not a timestamp-only cache. Use isomorphic-git's
public status, stage walker and blob hashing APIs to compare current regular-file
bytes and executable mode with the index. The read-only status pass retains the
library's tracked/ignored-path handling without publishing refreshed stat entries.
Read each tracked file again rather than trusting its cached working-tree OID.

Stage at most sixteen changed paths individually and sequentially. Unchanged
files are neither compressed nor rewritten. Larger batches, callback-only
filesystem adapters, configured line-ending conversion, and unsupported tracked
file kinds use the existing recursive, serial library staging path. Verification
errors propagate; they never imply an unchanged file or permit an empty commit.
Deletions retain the existing checkpoint removal path.

The working-copy queue, editor write barriers, interrupted-checkout recovery,
commit graph handling and non-forced push contracts remain unchanged. No custom
index format, dependency fork, content cache or new native Git engine is introduced.

## Verification

Disposable real repositories cover unchanged packed objects, additions, binary
bytes, frontmatter, modes, symlinks, conversion configuration, broad edits, read
failures and callback adapters. Retain the rapid equal-length edit and immutable
pack-cache regressions. Compare optimized native Release builds against the same
6,000-file fixture on iPhone and iPad, including unchanged-sync timings and timer
scheduling delay. These measurements are not physical-device or animation-FPS
certification.
