---
type: ADR
id: "0230"
title: "Bundled offline mobile starter vault with recoverable publication"
status: active
date: 2026-10-17
---

Platform: mobile

## Context

First use on a phone or tablet must work without GitHub authentication, a folder
picker, or a network connection. The owner requested a writable local copy of the
canonical Getting Started vault embedded in the app. A failed catalog restore
must not trigger onboarding or replace existing vault content.

ADR 0046 downloads the desktop template at runtime. This decision supersedes that
distribution choice for mobile only and retains ADR 0070's local-first policy.

## Decision

Bundle a revision-pinned copy of `refactoringhq/memoria-getting-started`, including
its attachments and saved views, without its Git metadata or a configured remote.
Keep binary attachments as packaged assets rather than base64 JavaScript strings.
An app update may change the bundled template, but never refreshes an existing
writable copy. Canonical template documents, including agent guidance files, are
vault data, not application configuration or executable instructions.

Only a genuinely new installation creates the starter automatically. A valid
existing catalog, including an intentionally empty catalog, does not qualify.
Legacy import migration takes precedence. Invalid catalogs retain the recovery
flow. Unregistered vault directories are treated as recoverable data, not evidence
that the installation is empty.

Preparation is serialized independently of catalog publication. An immutable,
validated marker identifies the template revision and label. Files are populated
in an app-owned staging directory, then the complete directory is renamed into
`Local Vaults/getting-started`. The catalog is registered only after that rename.
The retained marker permits retrying a failed catalog registration without
recopying, deleting, or overwriting published content. Recovery also checks for
other unregistered vaults so an old starter marker cannot hide a lost catalog.

An interrupted preparation can resume the same revision. Invalid metadata,
ambiguous staging/destination pairs, or an unavailable older revision fail closed
and preserve both directories for recovery. Do not merge files from different
template revisions or infer ownership of an unknown staging directory.

## Consequences

The starter increases application download size but needs no runtime network or
credentials. Updating its content requires a new application build. Native
first-launch and relaunch tests must use disposable installations on both iPhone
and iPad, verify packaged attachments, and confirm user edits survive relaunch.
Tests must distinguish missing metadata from an empty vault and inject failures
before directory publication and during subsequent catalog registration.

Desktop onboarding and existing mobile vaults retain their current behavior.
The storage preparation primitive can be landed independently; automatic startup
wiring and packaged-template verification are required before declaring the
offline onboarding feature complete.
