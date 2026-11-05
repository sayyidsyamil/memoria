---
id: 0226
title: "Consent-bound iOS native crash reporting"
status: accepted
date: 2026-10-15
---

## Context

ADR 0225 deliberately deferred native fatal crashes because React Native's
JavaScript `beforeSend` cannot redact Cocoa reports. TestFlight needs actionable
native diagnostics without transmitting note content or account information.

## Decision

- Keep JavaScript capture on the existing bounded, revocable transport. A small
  local Expo module initializes the already-bundled Sentry Cocoa SDK only after
  persisted crash consent is loaded and enabled. No new analytics identity is
  introduced. Android native capture remains outside this iOS release.
- Reconstruct native events from an allowlist: event identity/time/severity,
  validated build metadata, numeric thread identifiers, bounded address-only
  stacks and image UUIDs. Discard messages, dynamic symbols, file paths, thread
  names, registers, user data, breadcrumbs, contexts and attachments. Preserve
  the crashed binary's validated version when reporting after an upgrade.
- Disable automatic sessions, tracing, breadcrumbs, hangs and HTTP capture.
  Native crash handling uses the vendor SDK, not a custom signal handler.
- Give the SDK its own ephemeral URL session and bounded, generation-specific
  cache. Revocation closes the consent gate, cancels the session, closes the SDK
  without a flush wait, detaches the generation, then removes cached files.
  Late writes to a detached generation can never be read by a later opt-in.
- Loading settings is not opt-out: do not erase a prior crash before persisted
  consent is known. The native SDK stays off while settings load. Crashes before
  consent restoration are therefore not captured.
- Native SDK headers and payload tests are the compatibility contract. A
  simulator-only launch argument records the sanitized recovered event for
  real crash/relaunch QA; this code is excluded from physical-device builds.

## Consequences

This supersedes only ADR 0225's deferral of iOS native capture. Its independent,
default-off consent and mobile attribution rules remain. Symbolication requires
the matching dSYMs and JavaScript source maps in Sentry. Server-side IP retention
and dashboard acceptance must be verified before distribution; an accepted
ingestion response or local crash proof is not that verification.
