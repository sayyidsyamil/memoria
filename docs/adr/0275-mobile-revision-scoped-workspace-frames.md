# 0275: Preserve the mobile workspace shell across prepared snapshot revisions

Date: 2026-10-22
Status: Accepted
Platform: mobile
Supersedes: ADR 0196's whole-workspace remount requirement only

## Context

The editor replacement barrier protects working-copy files from stale saves.
Previously each published vault revision also remounted the entire workspace,
discarding search, selection, navigation history and list component lifetime.
Keeping those components mounted must not revive old editor callbacks, undo
entries, lazy reads, retries or late persistence failures against fresh content.

## Decision

- Retain the existing freeze, flush, write-drain, recovery and source-preparation
  barriers. Only their successfully published revision installs a new snapshot.
- Own snapshot, snapshot reference and undo history in a revision-scoped frame.
  Install the replacement frame before committing children; subscribe through
  React's external-store API. Ordinary parent renders do not replace that frame.
- Keep the same-root workspace/controller mounted. Native root identity, not
  note count, ordering, selection or display label, determines its React key.
  Rich and raw editor documents alone receive the published revision key.
- Require exact frame identity and the current editor generation before applying
  prepared actions, including immediate actions and retries. Invalidate obsolete
  queues and lazy reads. Late persistence completions retain only their retired
  frame's setters and cannot mark fresh content failed or change its history.
- Clear a failed load boundary on the next revision without remounting healthy
  children. Failure/recovery UI still excludes stale editable content.

## Consequences

Successful same-root refresh preserves controller state and mounted list surfaces;
new authoritative documents deliberately start with fresh editor and undo state.
Actual vault switches still reset the workspace. This is not a conflict-merging
algorithm, does not permit editing during file replacement, and does not turn
provisional cached startup into an authoritative editable snapshot. Those startup
and responsiveness requirements need separate acceptance evidence.

Regression tests exercise the real provider, shared persistence pipeline and
navigation together, including new notes persisted during a network wait, stale
callbacks, rejected hydration, failed retries and recovery-boundary reset.
