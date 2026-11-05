# ADR-0191: Durable iOS Vault Bookmarks

## Status

Accepted; supersedes the session-only reopening constraint in ADR-0190 for
standalone iOS builds.

## Context

ADR-0190 made native startup honest by requiring an explicit directory selection
instead of treating an app-private fixture directory as a user vault. Expo's
directory picker keeps its security-scoped access only for the current process,
so storing the selected URI alone cannot reopen the vault after an app relaunch.

A launch-scope iPad app must reopen the user's selected vault without weakening
the explicit permission boundary or allowing remembered user content to leak into
deterministic QA scenarios.

## Decision

Standalone iOS builds persist the selected directory as an Apple bookmark through
the local `MemoriaWorkspaceAccess` Expo module. The module resolves the bookmark
and starts security-scoped access before React Native reads the workspace. It
retains that access for the module lifetime and releases it when the module is
destroyed.

Expo Go does not include the local module and therefore remains session-scoped.
Missing, malformed, stale, revoked, or unreadable bookmarks fail closed to the
existing no-vault state. Explicit development sources and deterministic fixture
probes take precedence over a remembered vault.

## Consequences

- Standalone iPad builds can reopen the last explicitly selected vault.
- Memoria never treats a persisted URI as proof of filesystem permission.
- Expo Go users must select the vault again after a restart.
- QA routes remain deterministic even when the simulator has a remembered vault.
- Multiple remembered vaults remain outside the launch scope.
