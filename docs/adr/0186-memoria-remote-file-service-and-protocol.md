---
type: ADR
id: "0186"
title: "Memoria remote: git-backed file service and versioned protocol"
status: active
date: 2026-10-12
---

## Context

Memoria Web needs a remote that hosts a vault (ADR 0185 added the web target and the `VaultBackend` seam it plugs into). The vault must stay what it is on the desktop: markdown files in a git repository the user owns, usually with a GitHub remote the desktop app also pushes to. Real-time collaboration on Yjs ships in the first web beta, but the first file service may be last-write-wins per file, provided nothing in it rules collaboration out (decisions of 10 Oct 2026). The open pieces, including this server, live in this repository; accounts, billing and payments do not (decision of 12 Oct 2026, TOL-25).

## Decision

**The Memoria remote is a TypeScript/Node service in `apps/server` that owns a git working clone of one vault and serves a versioned HTTP protocol whose types live in `packages/protocol`. Every save is one commit between a pull and a push; every write carries the revision it was based on, and a stale write becomes a conflict copy.**

- Protocol: routes under `/v1`, a `Memoria-Protocol-Version` header, capabilities, and an `etag` (the git blob id) on every file. Specified in `docs/web/protocol.md`.
- Writes require a precondition (`If-Match`, `If-None-Match: *`, or an explicit `If-Match: *`). The server never force-pushes; when its unpushed commits meet new remote commits, the remote's history wins and local changes are replayed, contested files as conflict copies.
- Collaboration is reserved, not built: a websocket route per `docId`, `collab.*` capabilities, a stable `docId` per note, and the document format `memoria.blocknote/1` built on a `Y.XmlFragment`.
- Server state that is not in git sits behind `BlobStore`, with a local-disk implementation; Object Storage is the intended production backend for it.
- The server shells out to the system `git` and has no third-party runtime dependencies. `apps/server` and `packages/protocol` are directories of the root package, like `apps/web`, imported by relative path; nothing in `src/` imports them, so the desktop bundle does not include them. They become pnpm workspace packages when the collaboration channel brings their first dependencies.
- Authentication is a bearer token from the environment. The server refuses to start without it and binds loopback unless told otherwise.

## Options considered

- **Node service over a git working clone, shared protocol package** (chosen): full git compatibility with the desktop app and GitHub, types shared with the web client, small. Cost: a process per git command (about 150 ms per save locally) and one server process per vault.
- **Rust service reusing the Tauri crates**: reuses vault parsing, but the collaboration path needs the BlockNote schema and Yjs, which are TypeScript; the protocol types would be duplicated.
- **Stateless service over Object Storage with git objects in the bucket**: scales across boxes, but needs a custom git storage layer and loses stock-git compatibility. Compared in `docs/web/s3-spike-report.md`.
- **No git on the server; files in a database or bucket, export to git**: simplest server, but breaks "files stay files in your git" and makes the desktop a second-class client.
- **Reject stale writes instead of writing conflict copies**: simpler, but a save is lost when the client disappears before resolving it.

## Consequences

- A self-hoster can run one vault with one token and a git remote. Multi-vault, identity, GitHub access on a user's behalf and permissions are not in this service yet.
- Save latency is dominated by git processes and, with a real remote, by network round trips; push and fetch cadence must change before real use.
- The web client needs a `remote` `VaultBackend` that speaks this protocol.
- The collaboration channel depends on `packages/markdown-yjs`, a headless markdown pipeline with the Memoria schema, which does not exist yet.
- The server tests run through `pnpm test` (`pnpm test:server`), not in CircleCI, which only typechecks and lints this package today.
- Re-evaluate when more than one box must serve a vault, when vaults grow beyond what a tree scan per request can list and search, and when the licensing boundary (`docs/web/licensing-boundary.md`, draft) is signed off.
