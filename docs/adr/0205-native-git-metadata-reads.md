---
type: ADR
id: "0205"
title: "Single-call native Git metadata reads"
status: active
date: 2026-10-10
---

## Context

Large-vault Git operations repeatedly query each file's existence, kind, size,
and timestamps. The Expo adapter previously requested existence and then file
information separately; Expo's iOS implementation performs additional permission
and attribute lookups for the individual fields. Reusing File handles does not
remove that repeated work. Caching metadata would risk hiding edits made between
operations, and cannot replace the rapid equal-length edit regression guard.

## Decision

The standalone iOS workspace module provides one synchronous `gitEntryInfo` call
that obtains fresh metadata with `fstatat`. A read-only descriptor anchors it to
the app sandbox, while validated home-relative URIs restrict it to Documents,
Caches, and temporary storage. `AT_SYMLINK_NOFOLLOW_ANY` rejects parent symlinks;
the returned mode also rejects leaf symlinks and unsupported special files.
The trusted home descriptor permits Apple's `/var` alias without permitting
vault-supplied aliases. It is closed when the module's reader is released.

The existing Expo Git adapter uses this optional capability for metadata only.
It still uses Expo for bytes, mutations, and asynchronous name enumeration. Git
internals are allowed through this adapter; the user-content writer separately
continues to reject `.git`. Missing capability means the existing Expo path,
not a startup failure; native access errors never silently fall back.

## Consequences

- No new dependency, metadata cache, Git implementation, or persisted schema.
- All stat fields describe one syscall observation. Git ctime uses inode-change
  time, not the document's birth date; user-facing creation dates are unchanged.
- A fresh stat is performed on every request. Content staging still catches
  equal-length edits with unchanged coarse timestamps.
- Pure adapter tests, actual filesystem tests, and the standalone iPad Git
  round trip verify the boundary. The 6,000-file debug fixture measures the
  result; debug-simulator timings are not release-device performance budgets.
- Expo Go and Android retain the existing adapter until an equivalent native
  capability is independently implemented and validated.

The installed Darwin `stat(2)` documentation and the SDK's `sys/fcntl.h` define
the no-follow behavior; Apple's [flag documentation](https://developer.apple.com/documentation/system/stat/flags-swift.struct/symlinknofollowany)
describes the same contract.
