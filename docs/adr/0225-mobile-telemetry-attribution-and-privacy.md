---
type: ADR
id: "0225"
title: "Cross-platform mobile telemetry attribution and privacy"
status: active
date: 2026-10-14
---

## Context

The mobile app needs comparable adoption signals and actionable error reports
without transmitting vault content. Existing mobile PostHog capture is already
consent-bound and bounded; the desktop browser SDK is not a native transport.
Startup responsiveness and explicit, independent consent remain requirements.

## Decision

- Retain the small PostHog capture transport from ADR 0214. Reuse desktop public
  project credentials. Match desktop event names where the action has the same
  semantics: note creation/deletion after persistence, vault open/switch after
  activation, search opening, successful manual commits and saved theme changes.
  Keep requested-operation events distinct from successful-action events.
- Attribute both services with `app_surface=mobile`, OS, phone/tablet family,
  app/build version, release channel and distribution. Versions are bounded and
  validated. Use ephemeral anonymous PostHog session IDs, no person profiles,
  no GeoIP and no identity inferred from GitHub authorization. Cross-device
  identity linking requires a future explicitly consented Memoria identity.
- Use the Expo-compatible official `@sentry/react-native` SDK and its matching
  `@sentry/core` transport utilities, not a hand-written Sentry protocol. Declare
  the matching `@sentry/cli` directly for pnpm-isolated native build scripts. Use
  `expo-application`, `expo-device` and `expo-constants` for native metadata.
  Load Sentry lazily only after independent, default-off crash-reporting consent.
- In this phase Sentry captures JavaScript/unhandled errors and caught workspace
  and persistence errors. Native fatal crash handling stays disabled: native
  reports bypass the JavaScript `beforeSend` filter and need a native privacy
  filter before activation. The bundled native SDK is not proof of native crash
  coverage. Do not claim that coverage until its separate acceptance passes.
- Reconstruct error payloads from an allowlist. Retain exception classes, stack
  coordinates, safe bundle filenames/functions and source-map debug IDs. Remove
  raw messages, user/request/context/extra data, breadcrumbs and attachments.
  Disable automatic sessions, tracing, replay, logs, screenshots, UI capture and
  failed-request collection. Transport has no durable queue, eight in-flight
  slots, five-second timeouts and immediate request cancellation on withdrawal.
- Revocation cancels an in-flight lazy SDK initialization and invalidates old
  transport instances. A reporting failure must not interrupt local work.
- Build configuration accepts existing `VITE_*` public desktop values and
  optional `EXPO_PUBLIC_*` overrides. Never include `SENTRY_AUTH_TOKEN` in app
  config. Sentry's official Expo plugin and Metro serializer prepare source maps;
  CI requires private upload credentials and matching release metadata. Local
  builds without credentials explicitly disable upload, not error collection.

## Alternatives

- Importing the desktop telemetry module would pull browser/Tauri assumptions
  into native code. Share event semantics and public config, not that runtime.
- Adding a second analytics SDK would replace an existing adequate transport
  and introduce storage/autocapture defaults without a current requirement.
- Enabling native crashes with only a JS scrubber would falsely imply that
  private native exception text is filtered.

## Consequences

Dashboard filtering can compare desktop and mobile actions without combining
their release identifiers. Offline analytics and JS error events may be dropped;
there is no persisted history of user activity. Native fatal crash coverage,
server-side source-map verification and any future cross-device identity model
remain explicit follow-up gates, not implicit capabilities of this integration.
