---
type: ADR
id: "0294"
title: "Web build error telemetry: its own build-time DSN, commit releases and hidden source maps uploaded by the deploy"
status: active
date: 2026-10-25
---

## Context

TOL-232 sends errors from the web build (memoria.lucaron.in) to Sentry, next to the desktop intake defined by ADR 0016. The web bundle is built from the same `src/` as the desktop, so it already contains `@sentry/react`, the consent flow and the scrubbing `beforeSend`. What differs: the web bundle is minified JavaScript served to browsers, so a stack is unreadable without source maps; serving those maps would publish the whole client source map of each deploy; a desktop DSN set in a build environment must not end up in the web bundle; and in a browser the SDK records page and request URLs, which on Memoria Web carry note paths and collaboration tickets.

## Decision

**The web build bakes in its own DSN from `MEMORIA_WEB_SENTRY_DSN` (unset = no telemetry) and a `memoria-web@<commit>` release, reuses the shared `initSentry` path and consent rules with a `platform: web` tag and URL scrubbing, and always emits hidden source maps outside the served output, which the deploy uploads to Sentry through its HTTP API when an upload token is configured.**

## Options considered

- **Build-time DSN and hidden maps uploaded by the deploy** (chosen): no new dependency, nothing served that was not served before, the same bundle runs with or without telemetry depending only on the build environment, and the upload is an optional deploy step.
- **Reuse `VITE_SENTRY_DSN` for the web**: one variable fewer, but a build machine with the desktop DSN would silently send web events into the desktop project, and CI would no longer be silent by construction.
- **`@sentry/vite-plugin` or `@sentry/cli` for the upload**: the official tooling and debug-id based matching, but a new dependency in the root workspace (the CLI exists only in the mobile workspace, with a downloaded binary). The release-file API needs only `fetch`.
- **Public source maps**: simplest for Sentry, but they publish readable source for every deploy and cost bandwidth.
- **Maps only when a DSN is set**: a little faster build in CI, but the code path that produces the maps would then be untested in CI and in every local build.

## Consequences

- `pnpm build:web` takes about 15 s longer and about 0.8 GB more memory for the maps; CI and the deploy already build with a 4–6 GB heap.
- `apps/web/sourcemaps/` (git-ignored) holds the maps and `manifest.json`; `pnpm upload:web-sourcemaps` uploads them (`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, optional `SENTRY_URL`) and skips without a token. The deploy pipeline in memoria-cloud runs it after `pnpm build:web` and reads the values from optional owner-only files (`docs/web/telemetry.md`).
- The front Worker's CSP `connect-src` allows the Sentry ingest hosts.
- Web events reduce request, page and breadcrumb URLs to the origin and first path segment; stack frame URLs are kept for symbolication. Desktop telemetry is unchanged.
- Consent works as on desktop. Web settings live in memory today, so crash reporting has to be turned on again in each session until web settings persist.
- Re-evaluate the upload method if Sentry retires release files (then debug-id artifact bundles), or if a Sentry build plugin becomes a dependency anyway.
