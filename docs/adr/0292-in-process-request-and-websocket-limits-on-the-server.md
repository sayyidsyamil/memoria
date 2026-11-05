---
type: ADR
id: "0292"
title: "In-process request and websocket limits on the server, per account"
status: active
date: 2026-10-25
---

## Context

The TOL-200 security review (`docs/web/threat-model.md`, sections 3 and 5) found that `apps/server` had no request rate limit and no cap on concurrent collaboration websockets: one client holding the token could fill a vault container with requests, git work and open documents. Edge rules in front of the container (Cloudflare) are owned and configured elsewhere and do not protect a container reached any other way. TOL-208 (plan row B4-8) asks for limits inside the server, with defaults the web app, collaborative editing and the e2e suites never reach, and overrides for tests and operators.

## Decision

**The server keeps one token bucket per account and counts open websockets per account and per document, in process. Beyond a limit it answers `429`; an idle socket is closed with `4408`. Protocol 1.6.**

- **Account.** One token is one account (protocol, "Authentication and transport"), and tickets are only issued to the token holder, so a ticket's websocket belongs to the same account. Requests without the token are charged to a separate anonymous bucket, so a flood of bad credentials never uses the account's budget. The limiter is keyed by account, so per-user tokens can get their own buckets later.
- **Requests.** `RateLimiter` (`apps/server/src/rateLimit.ts`): 50 requests per second, bursts of 500 (`MEMORIA_RATE_LIMIT_PER_SECOND`, `MEMORIA_RATE_LIMIT_BURST`). Every route but `/healthz` is charged before authentication. A websocket upgrade is charged once admission has decided: an admitted one to the account, a refused one (`401`, `404`) to the bucket its `Authorization` header selects, as for an HTTP request, so refusals without the token use the anonymous bucket and a flood of them is answered with `429`. (As first landed in TOL-208, refused upgrades were charged nothing; TOL-231 corrected that.) The answer is `429 rate_limited` with `Retry-After` in whole seconds and `details.retryAfterSeconds`. A token bucket rather than a fixed window: page loads and cache revalidation come in bursts, sustained load is what exhausts the container.
- **Websockets.** `ConnectionCounter` (`apps/server/src/collab/connectionLimits.ts`): 128 open sockets per account, 32 per document (`MEMORIA_COLLAB_MAX_CONNECTIONS`, `MEMORIA_COLLAB_MAX_CONNECTIONS_PER_DOC`). A place is taken before the handshake and freed when the TCP socket closes, however the upgrade ends, so a failed handshake cannot leak it. Beyond a limit the upgrade is refused with `429`, like the existing `401` and `404` refusals, before a room is opened. The message limit stays the body limit capped at 16 MiB, with its own override (`MEMORIA_COLLAB_MAX_MESSAGE_BYTES`).
- **Idle timeout.** `watchIdle` pings every socket each `MEMORIA_COLLAB_SOCKET_IDLE_TIMEOUT_MS` (60 s) and closes one that sent nothing since the last ping, not even a pong, with the new close code `4408`. Browsers answer pings on their own, so an open but quiet editor is never closed; only a dead or stuck peer is, and its place frees.
- **Protocol.** `rate_limited`, the `429` upgrade refusal and `4408` are additions, so the minor version goes to 1.6. Clients already back off: `CollabProvider` reconnects with a doubling delay after any refused or closed socket.

## Consequences

- One client can no longer hold more than 128 sockets or sustain more than 50 requests a second against a vault container; the rest of the box keeps serving.
- The limits are per process. A future server that holds several vaults or accounts needs per-account keys from real identities; the keyed limiter is ready for that.
- Expensive and cheap requests cost the same token. A per-route cost, a concurrency cap on git work and a websocket message-rate limit remain open (threat model, section 3).
- `createVaultServer` applies the defaults when `rateLimit` or `collab.limits` is left out, so tests run against the production limits unless they set others.
