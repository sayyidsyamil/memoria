---
type: ADR
id: "0187"
title: "Yjs collaboration with the markdown file as canonical form"
status: active
date: 2026-10-12
---

## Context

Memoria Web ships multiplayer in its first beta: co-editing, presence and live cursors (decision of 10 Oct 2026). ADR 0185 put a collaborative document channel next to the file path in `VaultBackend`; ADR 0186 reserved a websocket route, a stable `docId` per note and the document format `memoria.blocknote/1` in the remote protocol. Spike S4 (TOL-8) had to show that a Yjs document can sit on top of markdown files in git without the files ceasing to be the source of truth for the desktop app, for export and for history, and without a note changing in git because someone opened it.

The app's markdown serializer is not byte-stable: on the demo vault, parsing and serializing an unedited note reproduces its bytes for 1 note in 33.

## Decision

**A note is co-edited as a Y.Doc served by `apps/server`; the markdown file in git stays canonical. The server converts with the app's own markdown pipeline running headless, writes edits back over the bytes of the source file, and reconciles git changes into the live document with a three-way merge.**

- **One pipeline.** `packages/markdown-yjs` runs the editor's parse and serialize steps from `src/` on an unmounted BlockNote editor in Node (jsdom supplies the DOM), with a renderer-free copy of the editor schema that a test holds equal to the app's.
- **Document shape.** `blocks` is the `Y.XmlFragment` BlockNote's collaboration binds to; `frontmatter` is a `Y.Text` with the frontmatter verbatim; `meta` carries `format`, `baseRevision` and `conflictCopy`.
- **Source-preserving writes.** A flush merges, line by line, the serializer's rendering of the source file, the source file and the serializer's rendering of the document. Only edited lines change in the file; an unedited document is never written. The result is parsed and must read back as the document, or the serializer's form is written instead.
- **Cadence.** A document is flushed 5 s after the last edit or 60 s after the first unwritten one, when the last client has left, and at shutdown, through `Vault.update`, which computes the content under the vault lock after the pull.
- **Reconciliation.** A file change under a live document is adopted, merged three ways, or forked into a conflict copy, the file keeping its path. Unchanged blocks keep their Yjs items.
- **Transport.** y-protocols sync and awareness over `ws`, framed as y-websocket, one room per `docId`; a hand-written room of about 80 lines instead of Hocuspocus. Browsers authenticate with single-use tickets; a read-only ticket cannot change the document. A change is tried on a copy first and refused when it brings a node type, attribute, mark or shared type the format does not have; structure is left to the editors, because valid edits can merge into an invalid one.
- **Snapshots** of the Yjs state live in `BlobStore` so that reconnecting clients and the server share one history. They are a cache: a document can be rebuilt from its file.
- Protocol version 1.1; the file API is unchanged.

## Options considered

- **Y.Doc on top of canonical markdown, converted on the server** (chosen): the desktop, git and export keep working on files; collaboration is additive. Cost: the server carries the editor's markdown pipeline and a DOM shim, and reconciliation is needed.
- **Y.Doc as the source of truth, markdown as an export**: no reconciliation, but the desktop app would edit a derived artefact, and a vault would stop being readable without the server.
- **`Y.Text` of raw markdown**: trivially lossless, but BlockNote cannot bind to it; cursors and block identity would be lost and every client would reparse on every keystroke.
- **Write the serializer's output to the file**: simplest flush, but opening and touching a note would rewrite blank lines, escapes and image paths, and drop what the editor does not model, such as raw HTML blocks.
- **Hocuspocus**: persistence hooks and auth out of the box, but another dependency tree in a lockfile this repository cannot currently change, for what is a small amount of code on top of y-protocols; its persistence model also assumes the Y.Doc is the store.
- **Convert in the browser and send markdown**: no server-side pipeline, but two clients converting concurrently would produce duplicate content, and the server could not reconcile git changes on its own.

## Consequences

- A change to the markdown pipeline in `src/` changes what the server writes. The golden file in `packages/markdown-yjs/test/golden/` makes such a change visible in `pnpm test:server`.
- `yjs`, `y-protocols` and `lib0` are resolved from BlockNote's installed dependencies rather than declared, because declaring them rewrites `pnpm-lock.yaml`, whose existing findings the touched-file rule would require fixing. `apps/server/yjsResolution.ts` is the one place that knows; it goes away when the lockfile question is settled (`docs/web/s4-spike-report.md`).
- The server no longer runs from its sources alone: `pnpm run server` bundles the entry point first, because the shared pipeline is written for a bundler.
- Content the editor does not model stays in the file but is invisible in the collaborative editor.
- A room lives in one process: one server process per vault, with sticky routing.
- Re-evaluate if the desktop app adopts Yjs itself, or if reconciliation conflicts turn out to be frequent in practice.
