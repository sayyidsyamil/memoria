---
type: ADR
id: "0289"
title: "Server rename transaction with live wikilink patches"
status: active
date: 2026-10-24
---

## Context

A note renamed on the desktop has its wikilinks rewritten across the vault by `src-tauri/src/vault/rename.rs`. On the web the Memoria remote only moved the file (`POST /v1/rename`, protocol 1.0 to 1.3), so every link to a note renamed on the web broke, on the web and on the desktop after its next pull. TOL-22 (plan row B2-5) asks for a server rename that rewrites the links in one git commit, patches the live documents of affected notes so connected clients see the new links, and matches the desktop on its test cases. Other notes may be open as Yjs documents with edits that are not written yet (ADR 0187), and a rewrite must not drop or fork them.

## Decision

**`POST /v1/rename` takes `rewriteLinks`, `title` and `oldTitle` (protocol 1.4, capability `files.rename.links`). With `rewriteLinks`, the server moves the note, sets its `title` property on a title rename, and rewrites the links to it in every other tracked note, all in one commit. Each open document of a rewritten note gets the same rewrite as a targeted Yjs patch and moves to the new file revision.**

- **Parity.** `apps/server/src/renameLinks.ts` ports `collect_legacy_wikilink_targets` and `build_wikilink_pattern` without a dynamic regular expression: the old targets are the note's title, path stem and filename stem, matched case-sensitively; `[[target]]` and `[[target|alias]]` become `[[new/path-stem]]` with the alias kept; raw text anywhere in a `.md` file is rewritten, the renamed note itself is not. The title is read as the desktop reads it (`apps/server/src/noteTitle.ts`) and written with the shared frontmatter port (`src/lib/frontmatterText`). `apps/server/test/fixtures/rename-golden.json` holds the desktop's rename tests as golden cases.
- **Transaction.** `RenameTransaction` (`apps/server/src/renameTransaction.ts`) runs under the vault lock after the pull, stages the move, the title and the rewrites, and `Vault.rename` commits them once and pushes. The changes it reports carry the rewrite (`VaultChange.links`).
- **Live documents.** `CollabHub` hands a change with `links` to `NoteSession.relink`, which applies `patchLiveLinks` (`apps/server/src/collab/liveLinks.ts`): the `target` attribute of each matching `wikilink` element and the matching ranges of plain text (frontmatter, code), in one server transaction. If the patched document reads back as the rewrite of what it held, and the old file maps to the new one under the same rewrite, the session's base becomes the new file and the document stays as clean or as dirty as it was. Otherwise the new file is reconciled like a pulled commit.
- **Client.** The remote backend's `renameNote` sends `rewriteLinks: true`, the title and the old title, and reports `rewritten.length` as `updatedFiles`, so the existing rename toasts count the rewritten notes. `useNoteRename` sends title and filename renames through `createVaultBackend(...).files.rename`; the Tauri payloads are unchanged.

## Alternatives considered

- **Rewrite the files only, and let reconcile carry the change into open documents**: a link on a line someone is typing on becomes a conflict copy.
- **`codec.write` the rewritten markdown into open documents**: changed blocks are replaced whole, which loses an edit made in the same paragraph at the same time.
- **Rewrite links on the client**: one write per note, many commits, and a partial rename when the page goes away.
- **Also fix what the desktop leaves alone (`[[Old#heading]]`, other cases)**: the web and the desktop would disagree on the same vault; that change belongs in `rename.rs` first.

## Consequences

- A rename on the web is one commit that the desktop pulls with its links already rewritten.
- Like the desktop, links with a heading (`[[Old#h]]`), in other letter cases or through an alias that is not the title are not rewritten, and `[[Title]]` links follow the renamed note even when another note in another folder has the same title.
- A link typed into an open document of a note whose file has no link yet is not rewritten.
- Moving notes to another folder from the web UI, and renaming folders, still go through the mock path and are left for later; the server transaction already handles a `to` in another folder.
