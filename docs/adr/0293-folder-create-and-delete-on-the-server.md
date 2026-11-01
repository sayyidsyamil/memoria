---
type: ADR
id: "0293"
title: "Folders created on the server hold a .keep file; folder deletes take every file in one commit"
status: active
date: 2026-10-25
---

## Context

TOL-233 moves folder creation and deletion on the web from the browser mock to the Memoria remote, after TOL-227 did the same for folder renames (protocol 1.7). The desktop creates a folder as an empty directory and deletes one with everything in it after a confirmation. The server's vault is a git repository, and git keeps no empty folder: a folder exists on the server, and in every clone the desktop pulls, only while a tracked file is in it. The web derives its folder tree from the tracked files (`packages/collab-client/src/remoteFolders.ts`). Other tabs of the same remote must see the change without a reload.

## Decision

**A folder created through the protocol (`POST /v1/folders`, 1.8) is one commit adding an empty `<folder>/.keep` file; a folder delete (`POST /v1/folders/delete`) is one commit removing every tracked file under the folder. Tabs of the same remote tell each other about both over a `BroadcastChannel`.**

## Options considered

- **`.keep` placeholder file** (chosen): an ordinary, addressable tracked file. The desktop's vault scan hides dot files (`is_visible_vault_file`), so a pulled folder shows empty there; the web's entry list leaves dot files out the same way. It moves with a folder rename and goes with a folder delete, with no special case.
- **`.gitkeep`**: the common convention, but the protocol refuses every path segment starting with `.git`, so clients could not read, move or delete it.
- **Folders as server state outside git**: nothing for the desktop to pull, and the folder would vanish from every clone; against "files stay files".
- **The change feed (`GET /v1/changes`) for other tabs**: would also reach other devices, but no client consumes it yet, it needs a streaming fetch for the bearer token, and every autosave commit would wake every tab. A same-origin `BroadcastChannel` covers tabs of one browser with no server work; other devices see the folder on their next vault load, as for notes today.

## Consequences

- A folder made on the web stays after its last note is deleted, as on the desktop, as long as its `.keep` file is there; a folder that only ever held notes disappears from the web with its last note, because git has nothing to keep it.
- A folder delete takes no precondition, like the desktop's; a note with unwritten live edits is written back by its closing room, so a folder delete never loses typing.
- Re-evaluate the `BroadcastChannel` if the web starts consuming the change feed: that would replace it for folders and reach other devices too.
