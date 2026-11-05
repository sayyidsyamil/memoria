# 0238: Fresh-input-validated mobile snapshot cache

Date: 2026-10-18
Status: Accepted for the mobile foundation branch
Platform: mobile

## Context

Cooperative preparation (ADR 0236) shortens scheduling stalls but still rebuilds
metadata for every restored vault. Snapshot metadata includes editable note and
type sources, so a timestamp-only cache could turn an old document into a write
input. Persisted relative-date labels can also become incorrect between launches.

## Decision

The iOS index fingerprints the exact text delivered to JavaScript with SHA-256
after the existing recovery and native read boundary. Binary contents remain
outside this index: their snapshot text is empty and assets use separate readers.

For at least 128 files with valid native text digests, allow a private snapshot
cache only when its complete input fingerprint matches. This includes the parser
schema and native release/build identity, vault identity, config, preview limit, ordered folder/file paths, kinds,
text digests, sizes and timestamps. Re-read the authoritative index before every
lookup; do not trust same-size/same-mtime files, Git HEAD, or cached source bytes.

The cache envelope has a parser-schema version and a SHA-256 payload checksum.
Validate the decoded snapshot and compare its editable note/type text with the
fresh index again. Refresh all date labels through the same formatter as fresh
parsing. Bump the parser schema whenever snapshot parsing semantics change.

Use the existing Expo Crypto and filesystem dependencies. Store only under the
installation's cache directory, with hashed root keys, at most three recognized
files and a 32 MiB aggregate budget. Bound input size before decoding. Cache
failures and interrupted writes are misses, never vault-open failures; unknown
files and directories are not cleanup targets. A container-path change may cause
a safe cache miss. Do not persist subsequent editor/reducer mutations.

Retain the existing cancellation, recovery, save barriers and exact-index
single-use handoff. No background snapshot replacement, editor remount or new
user action is added. Runtimes without native text fingerprints use the fresh
cooperative parser rather than a weaker cache-validity rule.

## Limits

This avoids repeated snapshot parsing, not the authoritative disk/index read.
It does not complete provisional cached UI/background reconciliation, remove
every startup delay, provide whole mixed write-plan recovery, or extend the
custom iOS index guarantee to Android/Expo Go. Cache data is derived state and
may always be deleted; it is never a backup or synchronization source.

## Verification

Regressions cover independently reconstructed indexes, rapid equal-stat edits,
all identity inputs, type/view/relationship changes, editable-source comparison,
checksum/schema corruption, cache I/O failure, date labels and cancellation.
Native digest tests use known SHA-256 vectors and unchanged modification times.
Optimized native benchmarks separately report first and repeated fresh-index
loads, actual cache-hit state, snapshot cost and scheduling delay on disposable
fixtures. User vaults are not benchmark inputs.
