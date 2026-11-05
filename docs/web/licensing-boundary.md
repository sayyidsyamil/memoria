# Memoria Web: licensing boundary

> **DRAFT for Luca's sign-off.** Nothing here is final until Luca approves it. No paid or proprietary code lands before that. No license headers or additional `LICENSE` files have been added.

Basis: Luca's decisions of 10 Oct 2026 (client and protocol are AGPL, the hosted side is proprietary) and of 12 Oct 2026 (TOL-25, option c: the open pieces, including the file and sync server, live in `refactoringhq/memoria`).

## Where the line sits

| Module | Location | Licence | Repository |
|---|---|---|---|
| Shared shell and editor | `src/` | AGPL-3.0-or-later | `refactoringhq/memoria` |
| Web client build target | `apps/web` | AGPL-3.0-or-later | `refactoringhq/memoria` |
| Storage seam (`VaultBackend`) | `src/lib/vaultBackend` | AGPL-3.0-or-later | `refactoringhq/memoria` |
| Protocol specification | `docs/web/protocol.md` | AGPL-3.0-or-later (open question 1) | `refactoringhq/memoria` |
| Protocol types | `packages/protocol` | AGPL-3.0-or-later | `refactoringhq/memoria` |
| Markdown and Yjs serialisation | `packages/markdown-yjs` | AGPL-3.0-or-later | `refactoringhq/memoria` |
| Collaboration client (websocket provider, remote `VaultBackend`) | `packages/collab-client` | AGPL-3.0-or-later | `refactoringhq/memoria` |
| File and Yjs sync server, single vault, bearer token from the environment | `apps/server` | AGPL-3.0-or-later | `refactoringhq/memoria` |
| Accounts and authentication (sign-up, login, sessions, OAuth, GitHub App) | not written | Proprietary | private `memoria-cloud` |
| Billing and payments | not written | Proprietary | private `memoria-cloud` |
| Multi-tenant control plane (vault provisioning, quotas, sharing and permission records) | not written | Proprietary | private `memoria-cloud` |
| Agent API gateway | not written | Proprietary | private `memoria-cloud` |
| Deployment configuration and secrets for the hosted service | not written | Proprietary | private `memoria-cloud` |

In one sentence: **everything needed to self-host one vault is open; everything that makes it a multi-tenant paid service is private.**

## How the private side uses the open side

- `memoria-cloud` runs `apps/server` unmodified, as a separate process, and talks to it over the documented protocol and its configuration (environment variables, the storage interface). It sits in front as the authenticating proxy: it verifies the user, then forwards the request with the vault's service token.
- `packages/protocol` and `packages/markdown-yjs` are consumed by the open client and server from this repository. If `memoria-cloud` imports them, that needs one of the answers in open question 2.
- Changes to the server that the hosted service needs (hooks, limits, metrics) are made in the open repository. With AGPL's network clause this is also what the licence requires of anyone, including us, who offers a modified server to users.

## What this spike did

- Wrote only open code: `apps/server`, `packages/protocol`, tests and docs.
- Wrote nothing for accounts, billing, payments or any control plane. The only authentication is the bearer token read from the environment.
- Added no licence metadata. The new directories have no `package.json` of their own; the root `LICENSE` and the root `package.json` (`AGPL-3.0-or-later`) cover the repository.

## Open questions for Luca

1. **Protocol specification licence.** Code under AGPL is settled. Should the specification text (`docs/web/protocol.md`) be under a permissive documentation licence (for example CC BY 4.0) so third parties can implement compatible clients and servers without any doubt? Recommendation: yes; an interface specification under AGPL discourages the interoperability it exists for.
2. **Private code importing open packages.** If `tolaria-cloud` links `packages/protocol` or `packages/markdown-yjs` into proprietary code, AGPL would reach that code. Options: (a) Refactoring owns the copyright and licenses these packages to itself separately, which requires a contributor agreement for outside contributions to them; (b) publish those two packages under a permissive licence (MIT or Apache-2.0) while the client and server stay AGPL; (c) the private side never imports them and only speaks the protocol. Recommendation: (c) as the default, (b) for `packages/protocol` if the gateway needs the types.
3. **Contributor agreement.** Does `CONTRIBUTING.md` need a CLA or DCO before outside contributions to `apps/server` and `packages/*` are accepted? Without one, option 2(a) is not available.
4. **Sharing and permissions.** The first beta ships sharing with permissions. Enforcement has to happen in the sync server (a read-only session must have its updates rejected there). Is the enforcement mechanism open (in `apps/server`, driven by a signed ticket) with only the records and the UI for granting access private? Recommendation: yes; otherwise self-hosted multiplayer has no access control.
5. **Agent API gateway.** Listed as proprietary. Is the agent-facing protocol it exposes meant to be documented openly, like the file protocol?
6. **Trademark.** `trademarks.md` covers the name. Should the self-host documentation say what a self-hosted or modified server may call itself?
7. **Licence metadata.** After sign-off: when `apps/server` and `packages/*` become workspace packages, give each a `"license"` field and, if question 1 or 2(b) is answered that way, its own `LICENSE` file.
