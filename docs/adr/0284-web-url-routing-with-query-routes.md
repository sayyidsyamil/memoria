---
type: ADR
id: "0284"
title: "Web URL routing with query routes over the History API"
status: active
date: 2026-10-24
---

## Context

The web build always showed `/`. A reload reopened the last note only through `memoria:last-active-note-path` in localStorage, a link could not name a note, and the browser's back and forward buttons left the app. TOL-175 asks for URLs that name the vault, the note and the saved view, with back and forward walking the notes opened. Desktop must not change. The web constraints still apply: the cached shell paints within 1 s (`apps/web/tests/cache-startup.spec.ts`, ADR 0281), the app opens offline from the service worker's shell cache (ADR 0282), and no dependency or lockfile change.

## Decision

**The web build keeps its location in the query of `/`: `/?vault=<slug>&note=<vault-relative path>&view=<view file>`, written with `history.replaceState` and `history.pushState` and read back on `popstate`. No router library.**

- **Query, not path.** The service worker keys the cached shell by pathname, so every route is the same cached `index.html`, offline included, and the preview server or any static host needs no fallback rule. Slashes in the note path stay readable (`note=people/ada.md`).
- **Names.** `vault` is the vault's deep-link slug (`vaultDeepLinkSlug`, the same as `memoria://` links). `note` is vault-relative and must pass `isSafeVaultRelativePath`. A route whose vault is not the open vault opens nothing.
- **Startup.** The opening URL is parsed once in a `useState` initializer. Its note goes to `useLastActiveNote` as the preferred entry, so it opens at the moment the last note would have, after the cached entries are in; nothing new runs before first paint.
- **History.** The first sync after the note is restored replaces the opening history entry, so a reload or `/` does not leave an extra entry. Each later change of note or view pushes one. On `popstate` the app opens what the URL names and records it as already synced, so nothing is pushed back.
- **Scope.** `useActiveNoteLocation` (`useLastActiveNote` plus `useWebRouting`) routes only when `VITE_MEMORIA_WEB_BUILD` is `true` and in the main window. Desktop, including the browser dev build used by `tests/smoke`, keeps its URL; note windows keep their `?window=note` query.

## Alternatives considered

- **Path routes (`/note/<path>`)**: every deep path misses the service worker's shell cache and needs a fallback rule on each static host; relative asset URLs would need care.
- **Hash routes (`#/note/...`)**: work everywhere, but read as an in-page anchor and collide with heading links.
- **A router library (React Router, TanStack Router)**: a new dependency for three parameters, and it would want to own rendering, which the shell does not need.

## Consequences

- A reload keeps the open note and a copied URL opens the same note in another browser with the same vault. Back and forward walk the notes and views opened.
- The note-and-view history is the browser's; the sidebar's own back/forward buttons are unchanged.
- Sidebar selections other than saved views (filters, types, folders) are not in the URL yet.
- When the web build gains several vaults per origin, a route naming another vault should switch to it instead of opening nothing.
