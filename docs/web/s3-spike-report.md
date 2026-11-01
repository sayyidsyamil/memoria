# Spike S3 report: git-backed file service (TOL-5)

12 Oct 2026. Code: `apps/server` (service) and `packages/protocol` (wire types). Protocol: [protocol.md](protocol.md). Licensing: [licensing-boundary.md](licensing-boundary.md) (draft).

## Result

A small Node/TypeScript server hosts one vault as a real git working clone and exposes a versioned file API: list, read, write, rename, delete, search and sync. Every save is one git commit, made after pulling from the vault's git remote and followed by a push. A write states the revision it was based on; a stale write is kept as a conflict copy and never overwrites. The file path is last-write-wins per file, as agreed for this spike, and the protocol reserves everything collaboration needs so that it is additive.

Priority (a) from the 10 Oct decisions is done. Priority (b), the Yjs websocket channel, is not built; what is reserved for it and what it still needs is in "Collaboration" below.

| Area | State |
|---|---|
| List, read, write, rename, delete, search | Done, tested |
| Commit per save, pull before write, push after commit | Done, tested |
| Conflict copy on a stale write, including a push that lands mid-save | Done, tested |
| Remote unreachable: keep serving, commit locally, deliver later | Done, tested |
| Protocol version, capabilities, etag on every file, per-note doc ids | Done, tested |
| Bearer token from the environment, refuses to start without it, loopback by default | Done, tested |
| Storage for non-git state behind an interface, local-disk implementation | Done, tested |
| Yjs websocket channel, persisted Y.Docs, reconciliation | Not built. Route, capabilities, document format and doc ids reserved |
| `packages/markdown-yjs` | Not written. Seam described below |

## Stack and shape

TypeScript on Node 22, no framework and no third-party runtime dependency: `node:http` for the API and the system `git` binary through `execFile` (argument vectors, no shell). TypeScript was chosen over Rust so the protocol types, and later the markdown and Yjs serialisation, are shared with the web client. The server runs its `.ts` sources directly with Node's type stripping; there is no build step.

| Module | Responsibility |
|---|---|
| `packages/protocol` | Version, routes, capabilities, request and response types, error codes. No Node or DOM APIs |
| `apps/server/src/git.ts`, `gitRepo.ts` | Running git; the working clone: read, atomic write, commit |
| `gitSync.ts` | Fetch and integrate, push with retry, replay of unpushed commits |
| `vault.ts` | The operations, serialised under one lock; the write decision (`writeOutcome`) |
| `paths.ts` | Path validation, conflict-copy names, etags |
| `docIndex.ts`, `store.ts` | Doc ids; `BlobStore` interface and `LocalDiskStore` |
| `routes.ts`, `httpIo.ts`, `server.ts` | HTTP: routing, preconditions, auth, body limit, errors |
| `config.ts`, `main.ts` | Environment configuration and the process entry point |

The server's clone names its git remote `upstream`, not `origin`, so configuration aimed at a developer's `origin` remotes cannot redirect the vault's pushes.

## Tests

`pnpm test:server` runs 174 tests in 8 files with Vitest in a Node environment, against real git repositories in temporary directories: a bare repository stands in for GitHub and a second clone stands in for the desktop app pushing on its own.

| Covered | Where |
|---|---|
| list, read, write outcomes, rename, delete, search | `test/vault.test.ts`, `test/server.test.ts` |
| One commit per save, pushed to the remote | `vault.test.ts` "makes one commit per save and pushes it to the remote" |
| Pull before write | `vault.test.ts` "pulls before writing, so a desktop edit to another file is kept" |
| Conflict copy after a concurrent desktop commit | `vault.test.ts` "keeps the upstream version and saves a stale edit as a conflict copy"; `server.test.ts` "answers 409 with a conflict copy…" |
| Desktop push in the middle of a save | `vault.test.ts` "a desktop push that lands in the middle of a save" |
| Remote offline, replay onto upstream, including a folder that became a file upstream and a replay that fails half-way | `vault.test.ts` "when the git remote is unreachable" |
| Auth, protocol version, path traversal, body limit, error shapes | `server.test.ts`, `paths.test.ts` |
| Doc ids across edits, renames (also from git), restarts | `docIndex.test.ts`, `server.test.ts` |
| Token required, loopback only | `config.test.ts` |

Coverage of `apps/server/src` and `packages/protocol/src` (entry point `main.ts` excluded): 99.5% lines, 98.4% statements, 98.2% functions, 93.1% branches. The config enforces 90/90/90/80.

## Latency per save (measured)

`apps/server/scripts/bench.ts`: 100 consecutive saves of one note through the HTTP API, each a `PUT` with `If-Match`, timed in the client; phases from the `Server-Timing` header.

Setup: agent-claude (Hetzner, AMD EPYC-Genoa, 8 vCPU, ext4 on local disk), Node 22.23, git 2.43, a vault of 205 files, and the git remote a bare repository on the same disk.

| ms | mean | p50 | p95 | max |
|---|---|---|---|---|
| Total (client-side) | 145.5 | 145.9 | 158.0 | 188.7 |
| Pull (fetch, compare) | 40.1 | 40.0 | 45.2 | 46.9 |
| Commit (read, write, add, commit) | 35.8 | 36.0 | 40.7 | 50.2 |
| Push | 58.4 | 58.8 | 65.3 | 68.4 |

Reading the numbers:

- Almost all of it is process start-up: a save runs about 20 `git` commands. The file work itself is negligible at this size.
- This is the floor. With the remote on GitHub, the fetch and the push each add network round trips and an SSH or HTTPS handshake. **Not measured in this spike** (no GitHub repository was created); expect on the order of one to two seconds per save until the cadence below changes.
- A save holds the vault lock for its whole duration, so concurrent saves queue: at about 150 ms the server does six to seven saves per second per vault.

What M1 should change, in order of effect: push on a debounce instead of inside the save (the response already carries `pushed`), fetch on a timer or a webhook instead of before every write, and replace the per-command processes with one long-lived `git cat-file --batch` or a git library for the read side.

## Conflict behaviour

- The client sends `If-Match` with the etag it edited. If the stored file is at that etag, it is updated.
- If the file changed since (the desktop pushed, or another web client saved first), the stored version keeps the path and the request's bytes are committed as `name (conflict 2026-10-12 1611).md` beside it. The response is `409` with the copy's path and the current etag of the original. Both files reach the git remote, so the desktop sees the copy too.
- Creating a file that already exists with different content gives the same result.
- If the desktop pushes the same file between the server's fetch and its push, the push is rejected, the server takes the remote's history, and its own version becomes the conflict copy.
- If a client edits a file that was deleted meanwhile, the edit wins and the file returns (`recreated`).
- A write with no precondition is refused with `428`; overwriting needs an explicit `If-Match: *`.

## Failure modes

| Failure | What happens | Gap |
|---|---|---|
| Git remote unreachable | Reads and writes continue; commits stay local; responses say `pushed: false`; the next write or sync delivers them | No background retry: a quiet vault stays unpushed until the next request |
| Push rejected three times in a row | `pushed: false`, commit kept locally | Same as above |
| Remote history rewritten (force push) | Treated like any divergence: remote wins, pending local changes are replayed, contested files become conflict copies | Local commits that were already pushed and then removed upstream are not restored |
| Server crashes mid-write | Files are written beside the index and renamed into place; on start the tree is reset to the last commit and untracked leftovers are removed | A commit made but not yet pushed is pushed on the next request, not at start |
| A change listener (doc index) fails after the commit | The client gets `500`; the commit exists and is pushed by the next request | The client cannot tell that its save landed; it will see a conflict copy or `unchanged` on retry |
| Replay of unpushed commits fails half-way | The clone is put back on the unpushed commits and the request fails; the next sync replays again | None known |
| Upstream put a file where a pending change needs a folder, or the reverse | The pending version is saved next to what is in the way, as a conflict copy (`inbox (conflict …)/note.md`) | None known |
| Server state directory lost | Doc ids are reassigned; files are unaffected | Live documents would have to be rebuilt from markdown |
| Doc index corrupt or from a newer server | The stored index is validated on start; the server refuses to start rather than trust it | Recovery is manual: delete the index and accept new ids |
| Disk full | Git or the write fails; `500`; the tree is reset | No disk monitoring |
| Two server processes on one clone | Not supported. The lock is in-process | Needs a lease before running more than one instance per vault |
| Very large vault | `list` and `search` scan the tree with git on every call | Needs the index below |
| Large file | Bodies are buffered in memory up to the limit (25 MB default) | Streaming and Git LFS or object storage for attachments |
| Token leak | Full read and write access to the vault | One static token, no rotation, no per-user identity |
| Hostile paths | `..`, absolute paths, `.git*`, control characters and backslashes are refused; every git command runs with `core.symlinks=false`, so a symlink pushed to the vault is a plain file and is never followed; git gets paths as literal pathspecs | Case-insensitive collisions (`Note.md` and `note.md`) are not detected; they matter for macOS and Windows clones |
| Vault with git hooks | A fresh clone has no hooks | A reused clone directory that already has hooks would run them |

## Storage: Hetzner Object Storage

The chosen store is Hetzner's S3-compatible Object Storage. Two ways to use it:

- **A. Working copy on the box.** The box serves files from a local git working clone, as this spike does. Object Storage holds backups or a mirror of the repository and the Y.Doc snapshots.
- **B. Stateless box.** The box is a front for the bucket. Git objects and packs, refs and Y.Doc snapshots live in the bucket; the box keeps at most a cache.

| | A. Working copy on the box | B. Stateless front for Object Storage |
|---|---|---|
| Latency | Local disk: about 40 ms to commit here. Reads are a file read | Every object read is an HTTP request of tens of milliseconds. A commit touches a blob, the trees up the path, a commit and a ref: several requests in sequence. A cold read of a note walks commit, trees and blob. Needs an aggressive local cache to be usable |
| Git compatibility | Full: the stock `git` binary, any remote, hooks, LFS, signed commits. The desktop app's history is the server's history | Git has no native S3 backend. Options are a custom object database (isomorphic-git or libgit2 with a bucket backend), or keeping bundles or packs in the bucket and unpacking them on the box. Packing, garbage collection and ref updates must be reimplemented or run on a temporary local copy. Ref updates need a compare-and-swap, which S3 conditional writes may or may not provide on Hetzner: to verify |
| Cost | A volume per box, sized for all vaults on it. Object Storage only for backups | Hetzner bills Object Storage as a monthly base price that includes a storage and egress quota, then per TB. Pricing is not quoted here: check the current price list before deciding. Many small git objects mean many requests; packs are cheaper to store and slower to update |
| Backups | Must be built: `git bundle` or a mirror push to the bucket on a schedule, plus the state directory. The GitHub remote is already an off-box copy of the files | Inherent durability of the bucket; versioning or object lock for point-in-time recovery. Still needs protection against a bad write by our own code |
| Multi-box scaling | One box owns a vault. Scaling is sharding vaults across boxes, with a routing layer and a way to move a vault. No shared-nothing failover: losing a box means restoring its vaults from the mirror | Any box can serve any vault. Needs a per-vault lease or compare-and-swap on refs so two boxes do not write at once. A live Yjs room still has to live on one box, so sticky routing per document is needed either way |
| Y.Doc persistence | Snapshots in Object Storage through `BlobStore`, or on the volume. Either works | The same `BlobStore`, bucket only |
| Operational risk | Low and well understood | High: a custom git storage layer is the kind of code that loses data |

**Recommendation for M1: A, with Object Storage used for what it is good at.**

1. The box keeps the working clone (and the bare repository if there is no GitHub remote) on a volume.
2. Y.Doc snapshots, the doc index and attachments above a size threshold go to the bucket through `BlobStore`.
3. A scheduled `git bundle` of each vault goes to the bucket, with bucket versioning on, so a vault can be restored on another box.
4. One box per vault, with a routing table from vault to box. A Yjs room needs that stickiness anyway.

This keeps full git compatibility, which is the product's promise ("files stay files, in your git"), and it keeps a move to B open: the state that would have to move is behind `BlobStore`, and the vault itself can be re-cloned from its remote or its bundle. Revisit B when the number of vaults per box, or failover time, becomes the constraint.

What exists now: `BlobStore` (`get`, `put`, `delete`, `list` over `/`-separated keys) with `LocalDiskStore`. Keys are restricted to a safe alphabet that is also valid for S3 object keys. No bucket was created and no credentials were used.

## Collaboration: what is reserved and what is missing

Reserved in protocol 1.0, so that adding collaboration changes nothing in the file API:

- `GET /v1/collab/docs/<docId>` as the websocket route (answers `501` today); capabilities `collab.yjs` and `collab.awareness`; `collab.available` in `GET /v1/vault`.
- A stable `docId` per note, following renames, including renames arriving from git.
- The document format `memoria.blocknote/1`: a `Y.XmlFragment` named `blocks`, because BlockNote's collaboration binding edits a fragment and not a `Y.Text` of markdown; a `frontmatter` shared type; a `meta` map with `format` and `baseRevision`.
- `BlobStore` for snapshots, and `Vault.onChange`, which already reports every file change, including pulls, to listeners under the vault lock. That is the hook reconciliation attaches to.

Missing, in dependency order:

1. **`packages/markdown-yjs`**: markdown to `Y.XmlFragment` and back, with the Memoria BlockNote schema (wikilinks, callouts, math, highlights, sheets, whiteboards), running headless in Node. This is the hard part and the reason (b) was not started: the markdown pipeline in `src/` has client-only steps around BlockNote's converter. The gate is a golden-file test over `demo-vault-v2/`: markdown to fragment to markdown must be byte-stable, or opening a note produces a git diff.
2. **The room server**: y-protocols sync and awareness over `ws` (already in the lockfile, like `yjs`, `y-protocols` and `lib0`), one room per `docId`, loaded from a snapshot whose `baseRevision` matches the file or seeded from markdown.
3. **Flush**: serialise an idle document to markdown and commit it through the same `Vault` write path, skipping byte-identical results.
4. **Reconciliation**: when a pull changes a note with a live document, apply the change as a Yjs transaction or fall back to a conflict copy. The flow is drawn in `s1-tauri-inventory.md`.
5. **Access**: a short-lived ticket per connection carrying user, document and read or write access; read-only sessions enforced on the server.

## What M1 needs next

| Need | Notes |
|---|---|
| Multi-vault | One `Vault` per repository, a registry, routes under `/v1/vaults/<id>/…` (a new minor version; the single-vault routes can stay as an alias), a lock or lease per vault |
| Identity and GitHub access | Per-user identity and a GitHub App or OAuth to clone and push on the user's behalf belong to the private control plane (see the licensing draft). The open server needs only: a verified user in the request, and per-vault git credentials supplied through a credential helper, never in the remote URL. Commits should be authored as the editing user |
| Entry index and search index | `GET /v1/entries` in `VaultEntry` shape with frontmatter parsed once and updated on change, instead of the client parsing every file. Search over that index (title, type, snippet, score); `git grep` does not rank and rescans every time |
| Change stream | SSE or websocket of changed paths and etags, replacing the desktop's filesystem watcher. `Vault.onChange` is the source |
| Rename with wikilink rewrite | One commit covering the move and every note that links to it; needs the index |
| Attachments | Streaming upload, size and type limits, and large files in Object Storage or Git LFS rather than in git history |
| Sync cadence | Debounced push, timed or webhook-driven fetch, background retry of pending pushes, push at start-up |
| Backups | Scheduled bundle to Object Storage with versioning; restore drill |
| Operations | TLS-terminating proxy, rate limiting, request logging without note content, metrics, disk monitoring, graceful shutdown that waits for the vault queue |
| Workspace packages | `apps/server` and `packages/protocol` are directories of the root package, imported by relative path, as `apps/web` is. Registering them in `pnpm-workspace.yaml` rewrites `pnpm-lock.yaml`, and that file carries 37 existing Trivy findings (16 high or critical, all in third-party desktop dependencies) which the repository's touched-file rule would then require fixing or an owner exception. Do it together with the first real dependency (`ws`, `yjs`), with Luca's decision on the lockfile |
| CI | `pnpm test:server` is chained into `pnpm test`, which CircleCI does not run (the same is true of `test:web-config`). CI typechecks and lints the server through `pnpm build` and `pnpm lint`. A CI job for the server tests needs a workflow change, which this spike did not make |
| Web client | A `remote` `VaultBackend` in the shell that speaks this protocol, mapping `baseRevision` to `If-Match` and a `409` to the seam's conflict result |
