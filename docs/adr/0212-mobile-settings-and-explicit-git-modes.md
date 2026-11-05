# ADR 0212: Mobile settings and explicit Git modes

Date: 2026-10-11
Status: Accepted
Supersedes: ADR 0194's manual-only sync policy; ADR 0196's unconditional post-Git editor replacement.

## Context

The physical iPad review found Git undiscoverable and requested both automatic
sync and user-authored manual commits. Installation preferences must not modify
vault files. Native controls must retain Memoria's desktop language and work
without depending on browser CSS.

## Decision

- Add installation settings in the app-owned `.memoria-mobile-config/settings.json`.
  Validate reads and writes, publish through a pending-file rename, and retain a
  valid backup. Corrupt or unreadable settings never silently enable automation.
  Web previews use localStorage behind the same asynchronous storage boundary.
- Manual mode is the default. Commit creates a local Git commit with the user's
  message; Commit and sync then contacts the remote. Sync alone refuses dirty
  documents in manual mode, before any network request. Existing app-owned Git
  storage, save barriers and serialized write queues remain authoritative.
- AutoGit is explicitly opt-in and applies only to managed Git vaults. Coalesce
  edits after thirty seconds of idle time while foregrounded; check for remote
  changes every two minutes while active. Do not promise suspended/background
  execution. Pause scheduling while dialogs, restoration or another operation
  block editing, and stop on divergence. Never force push or overwrite conflicts.
- A confirmed result that did not change document files resumes the frozen
  editor and restores its generation. Local commits and no-op/push-only syncs
  therefore preserve selection and scroll state. Unknown failures and changed
  checkouts still invalidate stale callbacks and reload from disk.
- Reuse the RNR Switch composition with `@rn-primitives/switch` 1.4.0, matching
  existing primitive versions. Explicit native dimensions replace CSS-only
  assumptions; do not introduce a custom toggle implementation.
- Keep preferences independent from vault controls. Settings include Git first;
  appearance, scale and consent-aware analytics are wired only with their
  corresponding implementation, rather than presenting inert controls.

## Consequences

The footer exposes settings, sync and commit controls. Manual commits are local
and do not require network access; GitHub authentication remains in SecureStore.
The settings file contains no token or document content. The shared pure
scheduler and settings controller support fast failure/recovery tests. Native
QA must also verify real commits, persistent settings and visible layout.
Large-vault Git staging still scans content to protect rapid equal-length edits;
foreground automation does not remove that cost or prove animation performance.
