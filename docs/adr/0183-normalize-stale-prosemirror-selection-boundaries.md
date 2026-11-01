# ADR-0183: Normalize stale ProseMirror selection boundaries

**Status:** Active

## Context

Memoria's Linux desktop release `2026.9.24` reported an unhandled `TypeError` while ProseMirror synchronized a DOM selection during editor teardown or remount. ProseMirror's `scanFor` helper reads a child returned from `node.childNodes` without accounting for that child being removed between position resolution and selection comparison. The latest available `prosemirror-view` release retains the same unsafe boundary access, so upgrading does not remove the race.

The failure happens below Memoria's editor controllers. A runtime monkey patch would depend on private module state, while catching the resulting global error would leave selection synchronization incomplete and hide unrelated failures.

## Decision

Patch the pinned `prosemirror-view@1.41.6` package through pnpm's existing `patchedDependencies` mechanism. When `scanFor` observes that its previously resolved child no longer exists, it normalizes the offset to the live parent's current end and continues the normal ancestor comparison.

Keep a focused DOM regression that removes the inline child during `EditorView.focus()` selection synchronization. The test must exercise the installed package patch rather than a Memoria wrapper.

## Consequences

- Editor remount and teardown races no longer dereference an absent child or collapse to a stale DOM offset.
- Memoria keeps selection behavior inside ProseMirror's existing equivalence algorithm instead of adding app-level error suppression.
- Every `prosemirror-view` upgrade must re-evaluate and either port or remove the patch after confirming the upstream implementation and regression test.
