# 0277: Reconcile Read-Only Mobile Reloads In The Existing Snapshot Frame

Date: 2026-10-22
Status: Accepted
Platform: mobile

## Context

A background scan must not replace edits or new notes made while it runs. A
single assignment of the scanned snapshot would lose that state; remounting the
workspace would also reset navigation and history. Working-copy replacement has
different safety requirements from a read-only scan.

## Decision

Give the existing revision-scoped snapshot frame a single-use background reload
ticket. Capture an authoritative baseline at scan start. Merge fresh results
against the frame's latest immutable state, preserving locally changed source,
fresh hydration, creations, moves, deletions, metadata choices and failures.
Untouched notes take the newly scanned values. Preserve current collection order,
selection and history; update the existing frame without changing its generation.

Use the existing cooperative task budget for collection indexing, source
comparisons and merging. Before publication, require the current snapshot to
still be the exact object merged. If input changed it during a yield, retry with
the newer state. Newer tickets cancel earlier ones. Cancelled, superseded and
already consumed tickets cannot publish. Cross-vault results, duplicate file
identities/case aliases and ambiguous new-file collisions fail without partial
publication. The merge never persists files or acknowledges failed writes.

## Boundaries

This is not a Git merge or a disk replacement operation. ADR 0275's save, freeze,
recovery and generation barriers remain mandatory when the working copy changes.
ADR 0273's provisional startup surface remains non-editable: this ticket alone
does not authorize cached source or type templates. Fresh startup admission,
runtime compatibility and measured native startup acceptance remain separate.

## Verification

Regressions exercise real reducer-generated create/edit/move/delete plans during
a scan, metadata merging, selection outside the recent-note window, exact-source
creation deduplication, failure retention, cancellation and supersession. A
6,000-note merge delivers queued timer input and retries without losing that
input. This deterministic scheduling check is not a native frame-rate claim.
