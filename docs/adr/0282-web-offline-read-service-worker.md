---
type: ADR
id: "0282"
title: "Web offline read with a hand-written, per-account service worker"
status: active
date: 2026-10-23
---

## Context

ADR 0281 made the web app open from an IndexedDB snapshot of the vault index. With no network the app still did not open: the shell (HTML, scripts, styles) and note bodies came only from the network. TOL-198 asks for the last vault to open offline, with recently opened notes readable, the offline state visible, and no edit kept silently to be sent later.

Three constraints shaped the decision:

- **No new dependency and no lockfile change.** Workbox and `vite-plugin-pwa` were ruled out.
- **Cached vault data is personal.** The web build talks to a Memoria server with a bearer token. A response cached for one account must never be served to another, and nothing may stay behind when an account signs out or is deleted.
- **First paint stays under 1 s on WebKit, iPhone and iPad** (`apps/web/tests/cache-startup.spec.ts`). A page controlled by a service worker sends every subresource through the worker's fetch handler, and WebKit paid 60 to 90 ms per request. The shell made about 130 requests before first paint, 114 of them Phosphor icon chunks. Each icon is its own chunk because the icon picker loads every icon through `import.meta.glob`.

## Decision

**The web build ships a hand-written service worker. It caches the shell in one versioned cache and the entries list and opened notes in one cache per account. Offline, the vault is read-only: the editor cannot change, vault writes are refused, and the sync pill says "Offline · read-only".**

- **Worker** (`src/lib/offline/serviceWorkerRuntime.ts`, bundled by `apps/web/serviceWorkerPlugin.ts` into `service-worker.js` for the web build only).
  - Navigations are cache-first.
  - Built files are cache-first, and the files the first paint needs are precached on install.
  - `GET /v1/entries` and `GET /v1/files/*` with an `Authorization` header are network-first, falling back to the cache of the account that sent the request.
  - Nothing else under `/v1` or `/api`, and no write, is touched.
- **Per-account caches** (`src/lib/offline/offlineCachePolicy.ts`).
  - Each cache is named `memoria-web-account-<sha256(server origin + Authorization)>`.
  - Entries are stored under the bare URL, so the credential is never written to Cache Storage.
  - A 401 or 403 drops that account's cache. The cache keeps the 200 most recent responses.
- **Clearing** (`src/lib/offline/offlineMode.ts`). `clearOfflineData()` deletes every `memoria-web-*` cache, messages the worker to do the same, and clears the ADR 0281 snapshot. It runs on the `memoria:account-signed-out` and `memoria:account-deleted` window events, which the account flows dispatch (TOL-199).
- **Read-only offline.**
  - The `offlineRead` capability is set only for the `remote` backend.
  - `useOfflineReadOnly()` turns BlockNote non-editable and puts CodeMirror in read-only mode (`useCodeMirrorReadOnly`).
  - `assertVaultWritable()` refuses vault-write commands in `mockInvoke`, property edits in `frontmatterOps`, and note create, rename and delete on the server (`src/lib/remoteNotes.ts`, TOL-202) before any request or local state change.
  - `useCollabEditorBinding` opens no live document offline, because a Y.Doc opened offline would keep edits to send later. A note that is already bound keeps its document, read-only.
- **Registration** runs only in the web build (`VITE_MEMORIA_WEB_BUILD`), outside Tauri, with a remote server, in a secure context, after `load` plus idle time. The desktop app and the desktop browser harness (mock backend) never register it.
- **First-paint budget.** A web-only Vite `manualChunks` rule (`apps/web/phosphorIconChunk.ts`) groups the icons that the source imports by name into two chunks.
  - One holds the icons in the entry's static graph, the other those of the lazily loaded app.
  - The picker's glob-loaded icons keep their own chunks.
  - Requests before first paint drop from about 130 to 19.
- **Cache matching ignores `Vary`.** Servers answer with `Vary: Origin`, and module scripts send `Origin` while the precache does not. Shell files are content-addressed and account caches are already per credential, so this is safe.

## Alternatives considered

- **Workbox or `vite-plugin-pwa`.** Ruled out: new dependencies.
- **One shared data cache with the user in the key.** One mistake away from cross-account reads, and harder to clear per account.
- **Queueing offline edits (Yjs keeps them locally, or an outbox).** Out of scope for TOL-198, and a silent queue is exactly what the card forbids. Offline editing needs its own conflict UX.
- **Relaxing the 1 s budget for worker-controlled loads.** The owner kept the budget. Grouping icon chunks keeps it without changing the desktop build.

## Consequences

- With the network gone, the web app opens the last vault, lists every note from the snapshot, and opens the notes this browser loaded before. Other notes fail to load, and no spinner covers the list or the editor.
- The desktop build is unchanged: no worker file, no registration, and no offline gate (`offlineRead` is false for `tauri` and `mock`).
- Playwright's `setOffline` cannot test a service worker. WebKit fails every load before the worker sees it, and Chromium lets the worker's fetches through after a navigation. `apps/web/tests/offline.spec.ts` serves the bundle from its own preview server, stops it to take the network away, and reports offline through `navigator.onLine`.
- Responses marked `cache-control: no-store` are still kept for offline read.
- The ADR 0281 IndexedDB snapshot is not yet keyed per account. Sign-out clears it.

### What triggers re-evaluation

- Offline editing becomes a requirement.
- More than one account per browser becomes common, so the IndexedDB snapshot needs per-account keys.
- The 1 s budget fails again as more statically imported modules are added.
