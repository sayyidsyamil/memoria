---
type: Note
_organized: true
---

# Memoria Web error telemetry (TOL-232)

Errors in the web build (memoria.lucaron.in) go to Sentry with readable stacks, through the same code the desktop app uses (`src/lib/telemetry.ts`, ADR 0016). Decision record: [ADR 0294](../adr/0294-web-build-error-telemetry-and-hidden-source-maps.md).

## What is sent, and when

- **Nothing without a DSN.** The web build gets its own DSN from the build environment. With no DSN, as in development, CI and every local build, the bundle never starts Sentry. The desktop `VITE_SENTRY_DSN` never reaches the web bundle: `apps/web/vite.config.ts` replaces it.
- **Nothing without consent.** Same rule as desktop: Sentry starts only when crash reporting is turned on (Settings → Privacy, or the consent dialog) and there is an anonymous id (`useTelemetry`).
- **Tags.** Every web event carries the tag `platform: web` and the release `memoria-web@<commit SHA>` of the build. Desktop events keep their own tags and calendar releases, unchanged.
- **Privacy.** The shared `beforeSend` scrubs vault paths and drops known benign errors. On web, request and breadcrumb URLs (page URL, fetch, XHR and navigation) are also cut down to the origin and first path segment, so note paths (`/v1/files/<path>`) and tickets in query strings never leave the browser (`src/lib/webSentry.ts`). Stack frame URLs stay as they are, because Sentry needs them to apply the source maps.
- **CSP.** The front Worker's `connect-src` allows the Sentry ingest hosts `https://*.ingest.sentry.io`, `https://*.ingest.us.sentry.io` and `https://*.ingest.de.sentry.io` (memoria-cloud `worker/src/security-headers.ts`).

## Source maps

`pnpm build:web` always generates hidden source maps (`build.sourcemap: 'hidden'`: no `sourceMappingURL` comment in the served files). After the bundle is written, the `memoria-web-hidden-sourcemaps` plugin (`apps/web/sentryWebBuild.ts`) moves every `.map` out of `apps/web/dist` into `apps/web/sourcemaps/` (git-ignored), with a `manifest.json` naming the release and the bundle file each map belongs to. Nothing under `apps/web/dist` is a map, so nothing deployed from it is.

`pnpm upload:web-sourcemaps` (`apps/web/sourcemapUpload.ts`) uploads them through Sentry's HTTP API: it creates the release, then uploads each bundle file (with a `Sourcemap` header naming its map) and its map as release files named `~/assets/...`. It skips cleanly, exit 0, when `SENTRY_AUTH_TOKEN` is not set. A failed upload exits 1.

## Configuration the deploy pipeline reads

The deploy runs in memoria-cloud (`infra/deploy/runner.sh` → `scripts/build-web.sh`, see its `infra/README.md`, "Web error telemetry"). It reads optional owner-only files from `~/.config/memoria-cf/` on agent-claude (chmod 600, one value per file) and passes each one to the build step as an environment variable. These are the names to fill once the Sentry web project exists (agents vault):

| File in `~/.config/memoria-cf/` | Environment variable | Read by | Value |
|---|---|---|---|
| `sentry-web-dsn` | `MEMORIA_WEB_SENTRY_DSN` | `pnpm build:web` | DSN of the Sentry **web** project (public by design: it ships in the bundle) |
| `sentry-auth-token` | `SENTRY_AUTH_TOKEN` | `pnpm upload:web-sourcemaps` | Sentry auth token allowed to create releases and upload release files (`project:releases`, or an organization token). Secret |
| `sentry-org` | `SENTRY_ORG` | `pnpm upload:web-sourcemaps` | Organization slug; required when the token is set |
| `sentry-project` | `SENTRY_PROJECT` | `pnpm upload:web-sourcemaps` | Web project slug; required when the token is set |
| `sentry-url` | `SENTRY_URL` | `pnpm upload:web-sourcemaps` | Optional; default `https://sentry.io` |

`MEMORIA_WEB_RELEASE` overrides the release name for a manual build; normally the build reads the commit with `git rev-parse HEAD`. A build outside a git checkout has no release, and the upload refuses it.

With none of these set, the deploy works exactly as before TOL-232: no DSN in the bundle, no upload.

## Checking it locally with a fake ingest

The CI build has no DSN, so `apps/web/tests/sentry-telemetry.spec.ts` checks there that nothing is sent with crash reporting on and that no map is served. The full path runs against a local fake ingest: build with a DSN that points at it, then run the same spec with the same variable.

```bash
export MEMORIA_WEB_SENTRY_DSN=http://publickey@127.0.0.1:48230/1
pnpm build:web
pnpm playwright:web apps/web/tests/sentry-telemetry.spec.ts --project chromium
```

The spec starts the fake ingest on the DSN's port, turns crash reporting on, throws an error from bundled code (`main.tsx`'s test bridge), and checks that the envelope carries `platform: web`, the release from `apps/web/sourcemaps/manifest.json`, and a throwing frame that maps back to the `throw` line in `src/main.tsx` through the hidden map. Rebuild without the variable afterwards.
