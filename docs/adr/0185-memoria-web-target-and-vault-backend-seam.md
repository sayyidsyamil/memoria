---
type: ADR
id: "0185"
title: "Memoria Web target and VaultBackend seam"
status: active
date: 2026-10-12
---

## Context

Memoria Web is the route to phones and tablets: the desktop React/BlockNote shell served as a web app against a remote that hosts the vault (plan of 8 Oct 2026, decisions of 10 and 12 Oct 2026). The AGPL web client, protocol, markdown/Yjs serialisation and file/sync server live in this repository under `apps/` and `packages/`; `src/` stays where it is and remains the shared shell.

The shell talks to the native side through about 160 scattered `isTauri() ? invoke(...) : mockInvoke(...)` branches (116 registered commands, 129 `isTauri()` call sites). There is no storage seam, so a remote backend has nowhere to plug in. Real-time collaboration on Yjs is in scope from the first web beta, which rules out a seam that models saving as whole-file last-write-wins.

The desktop release must not be affected: every push to `main` builds a desktop alpha.

## Decision

**Add Memoria Web as a separate, additive build target under `apps/web` that reuses `src/` unchanged, and introduce `VaultBackend` as the single storage seam, with a file path that carries base revisions and a separate collaborative document channel.**

- `apps/web/vite.config.ts` builds the repo-root `index.html` and `src/` into `apps/web/dist` (`pnpm build:web`, `pnpm preview:web`). `pnpm build`, `dist/` and the Tauri bundle keep using the root `vite.config.ts`. `apps/web/playwright.config.ts` checks the bundle in Chromium, WebKit and iPhone/iPad emulation (`pnpm playwright:web`).
- `src/lib/vaultBackend/` defines `VaultBackend`:
  - `files`: list, read, write, rename, delete, search, attachments. `write` takes `baseRevision`; a mismatch returns a conflict instead of overwriting. Omitting it is the explicit last-write-wins fallback.
  - `collab`: `openDoc(path)` returns the live document, fragment, provider and awareness an editor binds to through BlockNote's `collaboration` option. It is `null` for backends without collaboration.
  - `interfaceVersion` and `capabilities` so collaboration and server-enforced revisions are additive.
- One command adapter implements the interface over the existing Tauri `invoke` and the browser `mockInvoke`. Desktop implements only the file path.
- Callers are not rewired in this change. Migration is incremental, reads first, as described in `docs/web/s1-tauri-inventory.md`.
- Pushes that only touch `apps/**`, `packages/**` or `docs/web/**` do not build a desktop alpha (`shouldSkipAlphaRelease` in `scripts/release-version.mjs`).

## Options considered

- **Separate target reusing `src/`, plus a typed seam** (chosen): one shell and one editor for desktop and web; the desktop build and bundle are untouched; the remote backend is one more implementation.
- **Copy or fork `src/` into `apps/web`**: fast to start, but every editor and UI fix would have to land twice, which is the problem the React Native branch already had.
- **A build flag inside the root Vite config**: fewer files, but it puts web concerns into the config the Tauri release depends on.
- **Model the seam as the existing commands (`save_note_content` and friends)**: no new types, but it bakes whole-file overwrite into the interface and leaves no place for a live document.
- **Make the interface depend on `yjs` types now**: more precise, but adds a direct dependency to the shared shell before any code uses it. The collab bindings are structural until the web client instantiates them.

## Consequences

- The static web bundle currently runs on mock data. It becomes useful when the remote backend exists; until then it is the vehicle for device testing (`docs/web/s2-device-test.md`).
- Two code paths coexist until callers migrate: direct command branches and `VaultBackend`. New vault storage calls should go through the interface.
- The desktop adapter checks revisions by comparing content hashes before writing, which is not atomic (`capabilities.atomicRevisions` is `false`). The remote must enforce revisions itself.
- Web UI must follow the existing design language; deliberate departures are recorded in `docs/web/ui-departures.md`.
- ADR 0005 (Tauri iOS for iPad) describes a different mobile route and is not superseded here; that is a separate decision for the repository owner.
- Re-evaluate when the web client needs its own entry point, dependencies or workspace package, and when the shared shell first needs real Yjs types.
