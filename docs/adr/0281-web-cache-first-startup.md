---
type: ADR
id: "0281"
title: "Web cache-first startup with IndexedDB snapshot"
status: active
date: 2026-10-23
---

## Context

The Memoria web app (apps/web) fetches the full vault index (`GET /v1/entries`) on every startup before rendering the note list. With a large vault (6,000+ notes), this blocks the UI for 1–2 seconds on a fast connection and longer on slower networks. Users see a blank screen or loading skeleton until the fetch completes.

ADR 0185 established the web build as a first-class target using the VaultBackend abstraction. ADR 0280 added background fetch and debounced push to the Memoria remote server, plus `GET /v1/entries?since=<head>` for delta updates (`EntriesDeltaResponse` with `changed[]` and `deleted[]`).

The product requirement is that the web app renders the note list instantly on repeat visits, the same way the desktop app does from its local git clone. The technical requirement is that startup feels instant (paint within 1 second) without long-running main-thread tasks that block interaction.

## Decision

**The web app caches the full vault index in IndexedDB and renders from the cache immediately on startup, then revalidates in the background using delta updates (`GET /v1/entries?since=<head>`). The sync-pill spinner is the only reload signal; no blocking or reloading screen ever appears during revalidation.**

Implementation:

- **IndexedDB cache module** (`packages/collab-client/src/entriesCache.ts`): stores the vault index snapshot (`head`, `entries[]`, `cachedAt`) under the key `"snapshot"` in the `"memoria-entries"` database. Exports `readCache()`, `writeCache(head, entries)`, and `clearCache()`. All operations are safe when IndexedDB is unavailable (private browsing, blocked by policy) — they return `null` or resolve silently without throwing.
  
- **Cache-first loading in RemoteVaultBackend**: on the first call to `list()`, if a cache exists, return the cached entries immediately and start background revalidation with `GET /v1/entries?since=<cachedHead>`. The server responds with `EntriesDeltaResponse` containing only changed and deleted entries since that HEAD. Apply the delta in chunks (50 entries per chunk, yielding to the main thread between chunks via `setTimeout(0)`) to avoid blocking tasks over 200ms. Write the updated snapshot back to IndexedDB.

- **Full fetch on cache miss**: when no cache exists (first visit, or cache cleared), fetch the full list with `GET /v1/entries`, render it, and write it to the cache for next time.

- **Desktop unchanged**: the cache is web-only. The desktop app (Tauri) continues to use its local git repository through the existing VaultBackend implementation. The cache check is guarded by `typeof indexedDB !== "undefined"`.

- **Graceful fallback**: when IndexedDB is unavailable, the app fetches the full list on every startup. No error is shown; the experience matches the pre-cache web app.

## Alternatives considered

- **Service Worker cache** (with Cache API): more complex than IndexedDB for this use case (requires a separate worker script, cache invalidation logic, and request interception). IndexedDB is simpler and sufficient for a single snapshot.
  
- **LocalStorage**: too small (5–10 MB quota) for large vaults. A 6,000-entry index is about 2 MB as JSON; LocalStorage would fail on larger vaults or with notes that have long snippets.
  
- **No cache, server-side rendering**: the web app is a static bundle served by `pnpm preview:web`; SSR would require a server-side rendering step. Deferred; the IndexedDB cache is simpler and works with the existing static build.
  
- **Full revalidation on every load** (no delta): simpler (no `?since=` logic) but wastes bandwidth and server CPU when only a few entries changed. The delta update (ADR 0280) makes revalidation cheap.

## Consequences

### Performance

- **Cached startup paint time**: under 1 second on throttled 4G (measured in Playwright with network emulation).
- **First-ever load**: under 2 seconds on 4G with 6,000 notes.
- **No long tasks during revalidation**: chunked delta application ensures no main-thread task exceeds 200ms.

The cache brings the web app's startup performance to parity with the desktop app for repeat visits.

### Freshness

There is a window (at most a few hundred milliseconds after cache load, or longer if the network is slow) where the UI shows stale data before the delta arrives. This is acceptable:

- The delta fetch starts immediately after rendering the cached list.
- The sync-pill spinner shows revalidation in progress.
- When the delta arrives, the note list updates in place (no full-page reload or blocking screen).
- The user can interact with the cached list while revalidation runs.

If a note was deleted or renamed on another device, it remains visible in the cached list until the delta arrives. Clicking it fetches the current state from the server; a 404 or conflict is handled the same as in the desktop app.

### Cache invalidation

The cache is keyed by vault. When switching vaults (if the web app adds multi-vault support), `clearCache()` must be called. For now, the web app connects to one vault per origin, so cache invalidation is not needed.

### What becomes easier

- The web app renders instantly on repeat visits, matching the desktop app's perceived performance.
- The note list is interactive immediately; users can scroll, search (client-side), and click notes without waiting for the server.
- The delta update (`?since=`) is bandwidth-efficient and fast even on large vaults.

### What becomes harder

- The RemoteVaultBackend carries more state (cached HEAD and entries map).
- Playwright tests must account for cached vs. uncached startup paths.
- If the web app adds multi-vault support, cache invalidation must be wired up on vault switch.

### What triggers re-evaluation

- Observed staleness issues where the cached list is confusingly out of date for long enough to mislead users. The solution would be to shorten the delta fetch timeout or add a manual refresh gesture.
- Cache size limits if vaults grow to the point where IndexedDB quota is exhausted. The current implementation stores the full snapshot; a future optimization could store only recent notes or compress the cache.
- Different cache granularity if notes are edited so frequently that the delta response is large (e.g., collaborative editing with many concurrent users). The solution would be to fall back to a full fetch if the delta is too large, or to use shorter-lived caches.

## Advice

(No external input was sought before making this decision.)
