---
type: ADR
id: "0241"
title: "Source-free mobile snapshot previews"
status: active
date: 2026-10-18
---

Platform: mobile

## Context

ADR 0238 correctly requires a fresh native content-digest index before reusing an
editable snapshot. That index is still a blocking startup cost. Presentation may
be available sooner, but an old cached note or Type source must never become an
edit, recovery, or synchronization input.

## Decision

Keep the authoritative cache path and its fresh input/source checks unchanged.
Add a separate, explicitly provisional presentation reader with no dependency on
a file index. Its result is not a `MobileWorkspaceSnapshot`: it has no sync state,
document blocks, note raw sources, or Type raw sources/templates. It cannot be
passed to the existing editable repository contract without an explicit conversion.

Use one shared version-three cache envelope for both readers. Bind parser schema,
native build revision, exact root, alias, label, preview limit and vault config to
a presentation identity. The checksum covers that identity, the authoritative
input fingerprint and the payload together. Check decoded source identity and
collection/note shape before projecting metadata; recompute relative date labels.

Preserve the existing private cache directory, payload/aggregate size limits and
recognition-based retention. Invalid, old-version, interrupted, cancelled or
unavailable preview reads are misses, not vault failures. No preview read writes
to the cache or to a vault. Old envelopes miss safely and are replaced only by
the existing authoritative snapshot preparation path.

UI integration must use this value only for provisional presentation while the
fresh index is reconciled. Existing recovery/save barriers, authorization checks
and cancellation remain required; cached source text is never an editor input.
Navigation and focus must be verified when the authoritative workspace takes over.
The preview API alone does not implement cached first paint or an incremental
authoritative index.

## Alternatives

- Skip fresh-index validation: rejected because rapid equal-stat edits could be
  overwritten by stale source data.
- Return the full cached snapshot as editable: rejected for the same reason.
- Maintain a second persisted preview file: rejected to avoid duplicate cache
  publication, retention and invalidation rules.

## Verification

Behavioral regressions cover source-free projection, identity/build/config
mismatches, complete-envelope checksums, decoded shape, payload bounds, cache IO,
cancellation, date labels and unchanged authoritative rejection of equal-stat
edits. Native fixture timing reads the preview before indexing and reports its
hit/elapsed time separately. Those data-path timings are not screen-paint timings;
native phone/tablet first-paint and takeover checks belong to the UI integration.
