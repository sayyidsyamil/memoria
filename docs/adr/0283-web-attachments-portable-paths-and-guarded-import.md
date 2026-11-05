---
type: ADR
id: "0283"
title: "Web attachments: portable paths, token-authorized object URLs and a server-side guarded image import"
status: active
date: 2026-10-24
---

## Context

TOL-204 asks for images on the web: paste or upload them, see them, and see the same images in the desktop app after a pull. Pasted pages that point at remote images should import them, as desktop does.

Constraints:

- **Notes must stay portable.** Desktop writes `![name](attachments/<millis>-<name>)` and resolves that path against the vault root. The web must write the same thing.
- **Every request to a Memoria server carries a bearer token.** An `<img src>` cannot send an `Authorization` header, and the token must not go into URLs, where it ends up in logs, history and caches.
- **Browsers cannot fetch most remote images across origins**, so a web client cannot download pasted images itself. A server that downloads a URL a client gives it is an SSRF risk.
- **Desktop behavior stays unchanged**, and nothing may join the web's pre-paint path (`apps/web/tests/cache-startup.spec.ts`).

## Decision

**On a Memoria remote, attachments are ordinary vault files under `attachments/`, uploaded and read through the existing file routes with the bearer token. Images are shown through object URLs. Remote images are downloaded by the server through a new route that only reaches public internet hosts.**

- **Upload.** `files.saveAttachment` on the remote backend stores the bytes with a create-only `PUT /v1/files/attachments/<millis>-<sanitized name>` (`packages/collab-client/src/remoteAttachments.ts`). The name follows desktop's `prepare_attachment_path`. The editor's `uploadFile` resolves with that portable path, so the live document and the markdown the server writes link it the way desktop does.
- **Display.** BlockNote's `resolveFileUrl` is set only when a remote serves the vault (`src/components/richEditorFileUrl.ts`). It maps `attachments/...` URLs (`webAttachmentPath` and `resolveWebAttachmentUrl` in `src/utils/vaultAttachments.ts`) to object URLs of blobs fetched with the token, cached per path, with a failed read retried. Desktop and the mock browser get no resolver, so BlockNote behaves exactly as before. The attachment code is a lazily loaded chunk (`src/lib/remoteAttachments.ts`).
- **Import.** `POST /v1/attachments/imports {url}` (protocol 1.3, capability `attachments.import`) has the server download the image and store it like an upload (`apps/server/src/remoteImage.ts`). The guard mirrors desktop's `download_remote_image_to_vault`:
  - `http` and `https` only, with no credentials in the URL.
  - IP literals are checked before connecting. Host names go through a `lookup` that refuses the host when any resolved address is not public unicast, and the socket connects to the address that was checked.
  - Each redirect is re-checked, at most 5.
  - The answer must be a raster image type. SVG is refused, as on desktop.
  - 15 MB and 15 s caps.
  - Refusals are `400 invalid_request`. Download failures are `502 remote_unavailable`, a new error code.
- **Authorization** is unchanged: the bearer check in `apps/server/src/server.ts` already covers every `/v1/files/*` request, attachments included. Tests pin that down (`apps/server/test/attachments.test.ts`, `apps/web/tests/remote-attachments.spec.ts`).

## Alternatives considered

- **Tokens or signed tickets in attachment URLs.** Rejected: the credential would leak into the stored note, the URL bar and logs, or need a second signing scheme. Object URLs keep the token in headers.
- **Cookies for attachment requests.** Rejected: the web build has no cookie session, and adding one is a larger change with CSRF consequences.
- **Fetching remote images in the browser.** Rejected: most image hosts send no CORS headers, so most imports would fail.
- **`fetch` (undici) on the server.** Rejected: without the undici package, which would be a new dependency, it offers no way to pin the connection to the checked address. `node:http`/`node:https` with a custom `lookup` do.

## Consequences

- A pasted or uploaded image on the web is a commit on the server, and the desktop app shows it after a pull.
- The service worker of ADR 0282 caches attachment reads like other authorized `/v1/files/*` reads, per account, so viewed images stay readable offline. Uploads and imports are refused offline (`assertVaultWritable`).
- The server can be asked to GET arbitrary public URLs by an authenticated user. Rate limiting stays with the front proxy (see `docs/web/threat-model.md`).
- Images linked with note-relative paths (`../attachments/x.png`) and the raw editor's paste import are not resolved on the web yet.
