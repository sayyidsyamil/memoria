# ADR-0190: Explicit Session-Scoped iOS Vault Selection

## Status

Accepted; supersedes the implicit sandbox-root decision in ADR-0251.

## Context

ADR-0251 introduced the Expo FileSystem repository and defaulted native launches to
an app-private `Memoria Vault` directory. That directory is not a user-selected
Memoria vault, but its stale test files made a fresh install appear synced and
writable. Expo FileSystem also documents that an iOS directory selected through
`Directory.pickDirectoryAsync()` grants read/write access only for the current app
session. Persisting only its URI cannot restore the permission after restart.

The launch-scope iPad app must never display fixture or private sandbox content as
the user's vault, and it must not imply that an edit was saved when no writable
vault is selected.

## Decision

Native iOS launches without an explicit vault use a `noVault` workspace state.
The shell remains available for orientation, but its primary create and status-bar
actions open the native directory picker. All workspace mutations are ignored
until a writable native vault has been selected.

The selected directory is retained in React state for the current app session.
Memoria does not persist the URI as if it were a durable permission. A later native
storage integration may replace this decision only if it can retain and restore an
iOS security-scoped bookmark.

The local Laputa development bridge remains a read-only QA source. Attempts to
persist through it fail visibly instead of being silently discarded.

## Consequences

- Fresh iPad launches truthfully ask the user to open a vault and never expose
  stale app-private QA notes.
- A native folder must be selected again after each iOS app restart.
- Real filesystem writes remain available during the selected session.
- Deterministic layout probes continue to use fixtures when no source is supplied;
  real-vault QA must request the development source explicitly.
- Durable vault reopening remains blocked on a native security-scoped bookmark
  implementation rather than an unsafe URI-only cache.
