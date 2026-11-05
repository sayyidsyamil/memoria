# 0279: Mobile Preview Configuration Tolerance

Date: 2026-10-22
Status: Accepted
Platform: mobile
Supersedes: ADR 0241's exact config match for source-free presentation only

## Context

A display-setting change can invalidate startup presentation even when an intact
cache exists for the authorized vault. The user then sees a blocking reload while
the fresh index is prepared. Configuration equality is essential for editable
snapshots, but it does not establish write authority for source-free navigation.

## Decision

Keep the existing envelope format, checksum, size limits and private storage.
The presentation reader may tolerate only the serialized config field differing.
Schema, native build, root, alias, label and preview limit still match exactly;
decoded source and collection validation, authorization/recovery and cancellation
remain required. Verify the checksum over the original complete envelope before
projecting metadata, then use the current normalized presentation configuration.

The ordinary editable-envelope reader stays strict. Its config comparison,
fresh-input fingerprint and source checks are unchanged. Presentation still
removes raw note/type text, templates, document blocks and sync authority. It
cannot create or edit notes. No cache or vault writes occur during preview reads.

## Verification

Regressions reproduce the missing preview after a config change and require the
same change to remain an editable-cache miss. Retain cross-vault/build/limit,
checksum, malformed-identity, decoded-shape, cancellation and source-stripping
checks. This fixes a data-path cache miss, not instant cold-cache editing or a
native frame-rate guarantee.
