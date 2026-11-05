---
type: ADR
id: "0296"
title: "Sharing is enforced in the open server with signed, short-lived access tickets; share records stay with the front end"
status: active
date: 2026-10-25
---

## Context

TOL-18 (B5-2) lets a Memoria Web user share a note or a whole vault with another user as `editor` or `viewer`, and revoke it with immediate effect, open websockets included. The licensing boundary (`docs/web/licensing-boundary.md`, decided by Luca on 25 Oct 2026) puts enforcement in the open `apps/server` (AGPL), so self-hosted multiplayer has access control, and keeps share and account records and their API in the private `memoria-cloud` front Worker, which must not import the open packages and talks to the server only over the protocol. Until now the server had one credential, the bearer token, with full access. The hosted front end and the server are deployed separately, in either order.

## Decision

**The front end mints, per request, a signed access ticket for the user making it and sends it as the bearer credential instead of the token (protocol 1.9). The server verifies and enforces it on every route and on the websocket, and `POST /v1/access/revocations` refuses a user's older tickets and closes the connections the user's remaining grants no longer cover.**

- Format `ta1.<base64url JSON>.<base64url HMAC-SHA256>`, payload `{ v: 1, sub, grants: [{ scope: "*" | <path>, role }], iat, exp }`, at most 10 minutes of life. The HMAC key is HMAC-SHA256(server token, `memoria access ticket v1`): whoever holds the token can mint, so no new secret is configured and the token never leaves the front end.
- Roles: `viewer` reads, `editor` also changes file content in its scope, and adding, moving or deleting files needs `editor` on the whole vault; `owner` (vault scope only, or the token) can also revoke. Paths outside every grant are answered as missing and filtered out of listings, the index, search and the change feed.
- A collab ticket keeps the access ticket it was asked with; its websocket is tracked per subject and closed with `4403` when a revocation leaves it uncovered.
- The bearer token keeps meaning the owner with full access: the single-user path is unchanged.

## Options considered

- **Ticket in place of the token** (chosen): a server older than 1.9 answers it with `401`, so deploying the front end first fails closed instead of silently giving a viewer full access.
- **Token plus a ticket header**: an older server ignores the header and gives full access; the front end would have to probe capabilities first.
- **Server-side share records**: would move records the boundary keeps private into the open server, and give it a user database it does not need.
- **Asymmetric signatures**: the server would need a public key configured per deployment; the front end already holds the token, and an HMAC keeps verification cheap on every request.
- **Long-lived tickets in the browser**: revocation would then need a denylist that outlives restarts. Tickets are minted per request by the front end and never reach the browser, so the in-memory cutoff only covers a few seconds of in-flight requests.

## Consequences

- Note grants follow paths: after a rename the share no longer covers the note until the front end updates its record (docId-scoped grants would be an additive v1 field).
- A note-only editor cannot paste images (attachments are new files) and does not see the conflict copy its stale write produces.
- Revocation state is in memory: a server restart forgets cutoffs, which only matters for tickets minted in the seconds before it, and closes every socket anyway.
- Later fields (for example the co-author identity of TOL-238) can be added to the payload without a new version; a breaking change gets a new prefix while the server keeps accepting `ta1.`.
