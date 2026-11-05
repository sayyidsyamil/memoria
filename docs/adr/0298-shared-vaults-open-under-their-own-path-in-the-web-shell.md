---
type: ADR
id: "0298"
title: "A vault shared with the user opens in the web shell under /vaults/<id>, read only until its access is known"
status: active
date: 2026-10-25
---

## Context

TOL-237 (B5-3) builds the sharing UI on the TOL-18 model (ADR 0296):

- The owner invites another beta user to a note or to the whole vault, as `editor` or `viewer`, and can revoke.
- Every user has a "Shared with me" list.
- A viewer must see a clear read-only state.
- A revoke has to reach a note that is already open.

The hosted front end serves a shared vault at `/vaults/<vaultId>/v1/*` and mints the user's access ticket per request. The share records and their API (`/api/shares*`) stay in the private front end (licensing boundary D2). Until now the shell had one remote vault per page, at `window.MEMORIA_REMOTE_URL`. It kept one entries snapshot, and its live documents retried forever when the server refused them.

## Decision

**A shared vault is a page of its own: the shell at `/vaults/<vaultId>/` talks to `origin + /vaults/<vaultId>` with everything it already has. What the user may do there is read from `GET /v1/vault` `access`. Until that answer arrives the vault is read only, and a refused live document stops instead of retrying.**

- **Remote config.** `remoteVaultConfig()` (`src/lib/vaultBackend/remoteConfig.ts`) is the only place that builds the remote's base URL. It adds the page's `/vaults/<id>` prefix, so file reads, live documents, attachments and note lifecycle all go to the shared vault with no other change.
- **Opening a share.** "Shared with me" opens a share with a full navigation to `/vaults/<id>/?note=<path>`. The page starts over with its own backend.
- **Entries cache.** The snapshot is keyed per vault (`entriesCacheKey`): the own vault keeps the key it always had, and a shared vault gets `snapshot:/vaults/<id>`. Each opens instantly from its own cache, and neither overwrites the other.
- **Access state.** `src/lib/sharing/vaultAccess.ts` holds the page's access: `owner`, `checking`, `shared` (the grants) or `revoked` (401/403/404). Every surface reads it:
  - The editor is read only without a write grant.
  - The live document is opened with a read ticket for a viewer, and not at all while `checking` or once `revoked`.
  - `assertVaultWritable` refuses changes in a view-only vault.
  - A banner and the status bar say "View only".
- **Refused documents.** `CollabProvider` treats a `4403` close, or a ticket refused with 401/403/404, as final. It closes, and the backend's `onAccessDenied` makes the shell re-read its access:
  - A downgrade reopens the note read only.
  - A revoke shows a notice that cannot be dismissed back into the vault.
- **Share records.** The shell reads and changes them only through `/api/shares*` on its own origin (`src/lib/sharing/sharesApi.ts`). Without that API (self-hosting, the static preview, an Access-only principal) no sharing UI is shown.

## Options considered

- **Path prefix and full navigation** (chosen): every module that builds a URL already goes through one config. Switching vaults without a reload would mean rebuilding the backend, caches, live documents and routing state in place.
- **A `?vault=` query switching the backend**: the query already names the desktop vault slug in web routes (ADR 0284), and the backend is created once per page.
- **Waiting for the access before showing the shared vault**: this would put a request in front of the first paint. The cached list and REST reads are safe for any role, so only writes wait.
- **Letting the provider keep retrying after a revoke**: a revoked user would loop on refused tickets forever, with no explanation.

## Consequences

- A shared vault has no offline read yet. The service worker only caches `/v1/*` of the own vault; `/vaults/*` requests pass through it.
- A note-scoped share opens a vault whose list holds only that note. Creating notes there is refused by the server (`403`) like any other vault change without `editor` on `*`.
- Pending invitations (people without an account) are not covered: the API answers `user_not_found`, and the dialog says so.
