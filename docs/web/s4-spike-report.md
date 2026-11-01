# Spike S4 report: real-time collaboration on Yjs (TOL-8)

12 Oct 2026. Code: `packages/markdown-yjs`, `packages/collab-client`, `apps/server/src/collab`, `apps/web/src/collab`, `packages/protocol` (1.1). Protocol: [protocol.md](protocol.md). Decision record: ADR 0187.

## Go / no-go

**Go.** BlockNote's Yjs collaboration works against a small room server in `apps/server`, with the markdown file in git still the canonical form. The two things that could have sunk it did not:

- The Memoria markdown pipeline runs headless in Node, unchanged, on an unmounted BlockNote editor. The server builds and reads documents with the same code the desktop app opens and saves notes with.
- Opening a note does not produce a git diff, and an edit changes only the lines that were edited, even though the serializer is not byte-stable (see "Round trip").

| Acceptance criterion | State |
|---|---|
| 1. Two clients converge; cursors and presence visible; Playwright in Chromium, WebKit and a mobile viewport | Done. Three clients (desktop Chromium, desktop WebKit, iPhone 15 viewport) edit one note at once against a local server |
| 2. Markdown to Y.Doc to markdown lossless, or the losses listed; golden test over `demo-vault-v2/` | Done. Golden file over 33 demo notes and 3 fixtures; loss list below |
| 3. Commit cadence with measured numbers | Done. Proposal: flush 5 s after the last edit, at the latest 60 s after the first unwritten one |
| 4. Reconciliation prototype and tests, no data loss | Done. Three-way merge into the live document, or a conflict copy |
| 5. Write-up, protocol update, ADR | This report, protocol 1.1, ADR 0187 |

What is not done is listed under "Not built" and "Risks". The largest gap: the collaborative editor is its own page in the web build, not yet the note view of the full shell.

## What was built

| Piece | Where | What it does |
|---|---|---|
| Markdown and Yjs serialisation | `packages/markdown-yjs` | `NoteCodec`: markdown to a `memoria.blocknote/1` Y.Doc and back, headless. Source-preserving write-back, three-way line merge, block-level patching of a live document |
| Wire framing | `packages/protocol/src/collabWire.ts` | y-protocols sync and awareness in y-websocket's framing, shared by server and client |
| Room server | `apps/server/src/collab` | One room per `docId` on `GET /v1/collab/docs/<docId>`; snapshots; flush on a cadence; reconciliation; tickets; read-only access; changes checked against the editor's vocabulary before they are applied |
| Vault write path | `Vault.update` in `apps/server/src/vault.ts` | Computes the new file content under the vault lock, after the pull |
| Client | `packages/collab-client` | `CollabProvider` (websocket, reconnect, status), `createRemoteVaultBackend` (the `VaultBackend` seam), presence helpers |
| Web UI | `apps/web/src/collab`, `apps/web/collab.html` | The Memoria editor bound to a live document, presence avatars, live cursors and selections, sync status, conflict notice |

### Document format `memoria.blocknote/1`

| Shared type | Content |
|---|---|
| `blocks` (`Y.XmlFragment`) | The note body, in the shape BlockNote's `collaboration.fragment` binds to |
| `frontmatter` (`Y.Text`) | The frontmatter block exactly as in the file, delimiters included, or empty. Text, not a map, so comments, key order and quoting survive |
| `meta` (`Y.Map`) | `format`, `baseRevision` (etag of the file the document is in step with), `conflictCopy` (set after a fork) |

The server builds documents with a headless copy of the editor schema (`packages/markdown-yjs/src/schema.ts`). A test in `src/components` compares its ProseMirror nodes, attributes and marks with the app schema, so the two cannot drift unnoticed.

## Round trip (criterion 2)

Golden file: `packages/markdown-yjs/test/golden/round-trip-differences.json`, written by `roundTrip.test.ts` over every note of `demo-vault-v2/` and three fixtures that cover frontmatter and properties, wikilinks with aliases, callouts, tables, inline and block math, code blocks, nested lists, checklists, highlights, Mermaid and tldraw blocks.

**Nothing is lost between blocks and the Y.Doc.** For all 36 notes, blocks to Y.Doc to a second Y.Doc (state transfer) to blocks serializes to the same markdown as the blocks themselves.

**The serializer is not byte-stable**, and it is the app's own serializer, so the desktop has the same behaviour when it saves. Parsing and serializing a file without editing it reproduces the bytes of 2 notes out of 36. The differences:

| Difference | Notes affected | Content lost? |
|---|---|---|
| Blank line between frontmatter and body removed; trailing newline removed | 31 of 33 demo notes | No |
| Image path gets a `./` prefix (`attachments/a.png` to `./attachments/a.png`) | 1 demo note, 1 fixture | No |
| `*` escaped as `\*` in text (a CSV with spreadsheet formulas) | 1 demo note | No |
| `\}` unescaped; empty checklist item gains a trailing space | fixture | No |
| Hard line break (two trailing spaces) becomes a paragraph break | fixture | Formatting |
| A raw HTML block (`<div>…</div>`) is not represented as a block | fixture | Yes, if the file were rewritten whole |

Serializing twice gives the same text as serializing once for all 36 notes: the serializer's output is a fixed point.

**How the file stays stable anyway.** The server never writes the serializer's output over the file. It keeps the file it loaded (`source`) and the serializer's rendering of it (`canonicalSource`), and on a flush merges three texts line by line: the lines that differ between `canonicalSource` and the document's rendering are the edit, and only those replace lines of `source`. Then it parses the result and checks that it reads back as exactly the document; if not, it writes the serializer's form instead (never seen in the corpus).

| Property, tested on all 36 notes | Result |
|---|---|
| No edit: the bytes written are the bytes of the file (so no write, no commit) | 36 of 36 |
| One edit (each of the first 25 text nodes of each note in turn): the file differs in one hunk, and reads back as the document | 35 of 35 notes with formatting-only differences; the lossy fixture also reads back as the document, with the edited line in the serializer's form |

Consequences: a raw HTML block stays in the file and is not shown in the collaborative editor; a line with a hard break or an unusual escape is normalised only when that line is edited.

## Convergence, presence, cursors (criterion 1)

`apps/web/tests/collab.spec.ts`, project `collab` of `pnpm playwright:web`. It starts a Memoria server on loopback with a throwaway vault seeded fresh for the run, and launches desktop Chromium, desktop WebKit and WebKit with the iPhone 15 viewport on one note:

- each client shows three presence avatars, its own marked "(you)";
- all three type at the same time, two of them in the same paragraph;
- all three show the same text;
- each client draws the labelled carets of the other two;
- the phone shows the surface inside its viewport;
- the markdown file in git ends up as exactly `# Welcome from Chromium` and the merged paragraph, with frontmatter and wikilinks untouched;
- a second test takes a client offline, has both clients type, and checks that both catch up.

The same is tested without a browser in `apps/server/test/collab.test.ts` and `collabServer.test.ts` (real websockets).

## Commit cadence (criterion 3)

A document is flushed to its file, as one commit, when either holds:

- **5 s after the last edit** (someone stopped typing), or
- **60 s after the first edit that is not in the file yet** (someone never stops),

and also when the last client has left (after a 30 s linger) and when the server stops. A flush whose result is byte-identical to the file is skipped. Configurable with `MEMORIA_COLLAB_IDLE_MS`, `MEMORIA_COLLAB_MAX_WAIT_MS`, `MEMORIA_COLLAB_LINGER_MS`.

Measured with `pnpm run server:collab-bench <remote> 30` on agent-claude (8 vCPU, local disk, bare remote on the same disk, 205-file vault). Commits per minute over a 10-minute editing session, per policy:

| Session | Keystrokes | 2 s / 30 s | **5 s / 60 s** | 10 s / 120 s | 30 s / 300 s |
|---|---|---|---|---|---|
| Typing without a pause, about 60 wpm | 3000 | 2.00 | **1.00** | 0.50 | 0.20 |
| Writing: sentences, thinking pauses, a break now and then | 1345 | 3.00 | **2.10** | 0.70 | 0.30 |
| Reviewing: a small fix every 20 to 70 s | 181 | 1.40 | **1.40** | 1.40 | 1.10 |

The sessions are synthetic and seeded; the policy only looks at the times of the edits, so the table is computed without waiting. One session was then run for real, 20 times faster, through a websocket client and the real vault:

| Real run, "writing", 5 s / 60 s | |
|---|---|
| Commits made / predicted by the simulation | 21 / 21 (2.1 per minute) |
| Flush time (pull, serialize, commit, push), ms | mean 161.7, p50 161.7, p95 175.6, max 176.4 |

Reading the numbers:

- The proposal makes one to two commits per minute of active editing, for all editors of a note together: the number does not grow with the number of people typing.
- Compared with the desktop's save per 500 ms debounce, this is far fewer commits; compared with 10 s / 120 s it bounds what a crash can lose to one minute instead of two.
- A flush costs what an S3 save costs (about 160 ms locally). Against GitHub the pull and push dominate; that was **not measured** (no GitHub repository was created). The S3 recommendation stands: push on a debounce and fetch on a timer or webhook, off the flush path.
- History is noisier than hand-made commits. If that matters, squash on push or use a longer maximum wait; both are a configuration or a small change, not a redesign.

## Reconciliation (criterion 4)

When a pull brings a new version of a note that has a live document (`Vault.onChange`, under the vault lock), three texts in the serializer's form are compared: the file the document was in step with (`base`), the document now (`live`) and the new file (`incoming`).

| Situation | What happens |
|---|---|
| The document has no edits of its own | The document takes the file's content. Only the changed blocks are replaced, as one Yjs transaction |
| Both changed, different lines | Three-way merge; the document gets the desktop's changes and keeps its own; the next flush writes the merge over the new file |
| Both changed the same lines | Fork: the file keeps its path (the desktop wins the path, as for any stale write in S3); the document's version is committed next to it as `name (conflict YYYY-MM-DD HHMM).md`; the document takes the file's content and `meta.conflictCopy` tells the clients, which show a notice |
| The note was renamed | The room follows the note (`docId` is stable) |
| The note was deleted | The room closes (close code 4410). Unwritten edits are written back, which restores the note |
| The change arrives in the pull of the flush itself | Reconciled first, then the flush writes on top: no spurious conflict copy |
| The file changed while the server was down | The snapshot is reconciled with the file when the document is next opened |

Unchanged top-level blocks keep their Yjs items, so a cursor or a selection in a paragraph the desktop did not touch stays where it was (tested).

Tests: `apps/server/test/collab.test.ts`, "a desktop commit that lands on a live document" (10 tests) and "a restart" (3 tests), against real git repositories with a second clone standing in for the desktop.

## Access

Browsers cannot send an `Authorization` header on a websocket, so the client asks `POST /v1/collab/tickets` (bearer token) for a ticket and opens the websocket with `?ticket=…`. A ticket is 32 random bytes, opens one document once and expires after 60 s. A ticket with `access: "read"` joins a session whose document changes the server drops. Non-browser clients may send the bearer token on the upgrade request itself. Per-user identity is still outside the open server: the hosted proxy would request tickets on a user's behalf.

## Tests and how to run

| Command | What |
|---|---|
| `pnpm test:server` | 451 tests, 17 files: server, protocol, `markdown-yjs` (golden round trip), `collab-client`. Coverage 98.7% lines, 92.9% branches (floors 90 / 80) |
| `pnpm build:web && pnpm playwright:web` | Static bundle checks in five browser projects, plus the `collab` project |
| `pnpm run server:collab-bench <remote.git> [seconds]` | Cadence table and a real run. Writes to that remote: use a throwaway one |
| `pnpm run server` | The server. Note `pnpm run`: bare `pnpm server` is a pnpm built-in and does nothing useful |

To try it by hand:

```bash
pnpm server:seed ~/work/web/s4-test-remote.git
MEMORIA_SERVER_TOKEN=local-dev-token-0123456789 MEMORIA_VAULT_REMOTE_URL=~/work/web/s4-test-remote.git \
  MEMORIA_SERVER_DATA_DIR=/tmp/memoria-s4 pnpm run server            # 127.0.0.1:8787
pnpm build:web && MEMORIA_REMOTE_URL=http://127.0.0.1:8787 pnpm preview:web
# open http://127.0.0.1:4173/apps/web/collab.html?note=welcome.md in two browsers
```

## Dependencies: a decision for Luca

`yjs`, `y-protocols` and `lib0` are used directly by the new code but are **not declared in `package.json`**. They are installed, at the versions BlockNote pins, as dependencies of `@blocknote/core`; the code resolves them from pnpm's hoisting directory through one helper (`apps/server/yjsResolution.ts`), which the server runner, the Vitest config, the web Vite config and two `tsconfig` path maps use.

Why: declaring them rewrites `pnpm-lock.yaml`, and that file has 37 Trivy findings today (16 high or critical, in `@tiptap/core`, `prosemirror-view`, `@modelcontextprotocol/sdk`, `fast-uri` and others, none introduced here). AGENTS.md's touched-file rule would require fixing those, which means upgrading patched editor dependencies of the desktop app, or an owner exception. Neither was available in a headless run, so the lockfile was left untouched, as in S3.

What to decide: approve a lockfile exception (or fix the findings in the desktop lane) so that `yjs`, `y-protocols`, `lib0`, `ws` and `jsdom` (the last two are dev dependencies today but the server needs them at run time) become declared dependencies of workspace packages, and delete the resolution helper. Until then a BlockNote upgrade that changes its Yjs version changes ours with it, silently.

## Not built

| Gap | Notes |
|---|---|
| Collaboration inside the full shell | `apps/web/collab.html` is a page of its own. The shell has one editor instance and swaps markdown into it (`useEditorTabSwap`); collaboration needs an editor per document created with `collaboration`. That is the main M1 work on the client |
| `VaultBackend` file operations beyond read and write | `list`, `rename`, `delete`, `search`, `saveAttachment` reject by name: they need the server's note index (S3 next steps) |
| Properties panel on the `frontmatter` type | The type is synced and merged; no UI edits it yet |
| Images and attachments in the collaborative editor | Relative image URLs are not resolved against the server |
| Offline persistence in the browser | Edits made offline survive a reconnect, not a reload: no IndexedDB store yet |
| Per-user identity, sharing records | Private control plane. The open server enforces read or write per ticket |
| Snapshot garbage collection and history compaction | Snapshots grow with the document's edit history |
| GitHub latency | Not measured |

## Risks

| Risk | Detail | Mitigation |
|---|---|---|
| Lost history lineage duplicates content | If the server's snapshot of a document is lost and the document is rebuilt from markdown, a client that still holds the old document and reconnects merges two unrelated histories: the content appears twice | Snapshots are written on every flush and on close. M1: a document epoch in `meta` that makes a client discard a stale local copy |
| Edits in a block the desktop also changed, in flight | Reconciliation replaces changed blocks whole. Keystrokes typed into such a block and still on the wire are lost | The window is the network latency; a character-level diff inside changed blocks would close it |
| Crash between a fork and its conflict copy | The copy is written right after the vault lock is released | Persist the pending copy in the blob store first |
| Crash loses up to one flush interval | Unless a client still holds the edits; it then re-sends them on reconnect | Snapshot on a shorter timer than the flush |
| Serializer changes in `src/` change the server | By design: one pipeline. A change that alters the output shows as a golden-file diff in `pnpm test:server` | The server tests do not run in CircleCI yet (see below) |
| Headless editor needs a DOM | jsdom globals are installed in the server process | Contained in `packages/markdown-yjs/src/headlessDom.ts` |
| One process per vault, one room per process | A room cannot be shared between boxes | Sticky routing per vault, as recommended in S3 |
| A valid vocabulary is not a valid structure | Every change from a client is tried on a scratch copy of the document first and applied only if the result uses known shared types, node types, attributes and marks; otherwise nothing is applied and that connection is closed (4422). Framing, size and sync subtype are checked before that, `meta` is the server's, and a read-only session cannot change anything. Structure (which node may contain which) is deliberately not enforced: two valid edits can merge into a structure the schema does not allow, editors repair that when they read it, and a server that refused the merge would lock out a client that did nothing wrong | Acceptable for write-access collaborators, who can write any text anyway. The check walks the whole document per change: fine for notes, to be made incremental for very large ones |
| CI | `pnpm test:server` and the `collab` Playwright project are not run by CircleCI; no workflow file was changed | A CI job for the server lane |

## Next steps

1. Luca: the dependency decision above.
2. Shell integration: an editor per collaborative note, behind `VaultBackend.collab`, with the properties panel on the `frontmatter` type.
3. Server note index (`GET /v1/entries`), then the remaining `VaultBackend` file operations.
4. Document epoch, snapshot on a timer, pending conflict copies in the blob store.
5. Push on a debounce and fetch off the flush path; measure against GitHub.
6. A CI job for `pnpm test:server` and the collab Playwright project.
