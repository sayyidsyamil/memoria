# 0273: Browsable mobile startup metadata

Date: 2026-10-21
Status: Accepted
Platform: mobile
Supersedes: ADR 0242's inert-preview interaction policy only

## Context

The source-free startup preview protects against stale writes, but disabling its
entire input/accessibility tree makes background indexing feel like a frozen app.
Users should be able to scroll, browse metadata and choose a note while waiting.

## Decision

Keep the authorization, recovery, bounded preview lookup, cooperative preparation
and fresh-input cache checks unchanged. Make the existing cached list and tablet
sidebar usable for presentation-only navigation. Reuse the real navigation
selectors through a metadata-only input contract, not a fabricated editable
snapshot. Expose the loading status separately from accessible list controls.

Do not mount an editor or expose create, favorite, archive, delete or other file
mutation actions in this provisional surface. A note tap records only an ID
already present in the preview. After successful fresh preparation, carry that
ID into the authoritative selection; the normal fresh-note lookup rejects IDs
deleted since the cached presentation. Neither cached source nor cached Type
templates become write inputs. Cache misses and failures keep the recovery path.

An existing active workspace always wins over a startup preview. Never replace
its editor, focus, or draft because a preview or loading flag changes. Retry and
unmount retain their abort isolation. No new storage, native module or dependency
is introduced, and the same native runtime can receive the change through OTA.

## Limits

This makes background startup browsable, not provisionally editable. Opening an
editor still requires authoritative preparation. It does not remove disk indexing
or guarantee a fixed startup time, and it does not by itself replace the separate
synchronous fallback used after changed-file operations.

## Verification

Regressions cover interactive/source-free presentation, queued ID handoff, unknown
and late selection rejection, retry/cancellation and preservation of an already
mounted editor. Existing navigation selectors retain type/view/folder semantics;
fresh-input and equal-stat-edit cache regressions remain required. Test only
disposable vaults and retain normal analysis, coverage and CI publication gates.
