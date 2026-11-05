---
type: ADR
id: "0290"
title: "A live document keeps its edits on a desktop conflict; the incoming version becomes the conflict copy"
status: active
date: 2026-10-24
---

## Context

When a git pull brings a desktop commit to a note that is open as a live Y.Doc, `NoteSession` reconciles the two against the markdown it last wrote (the base): a document without unwritten edits takes the file, edits on different lines are merged three ways and applied as one server transaction, and edits on the same lines cannot be merged. Until now that last case forked the other way round: the file kept its path, the document's edits were committed as a conflict copy, and the document took the file's content, so the paragraph under someone's cursor changed while they typed and their words moved to another note. The web build never showed where they went beyond the sync pill's tooltip, and conflict copies looked like any other note in the list. TOL-15 (plan row B2-9) asks that a live document keep its edits, that the incoming version become the conflict copy, that editors be told, and that the copy be visible. Last write wins stays the technical fallback for notes without a live document, as `PUT` with `If-Match` already does.

## Decision

**A fork keeps the live document. It is rebased on the incoming file and flushed over it, and the incoming version is then committed next to it as a conflict copy, named in `meta.conflictCopy`. The web shell shows a notice for a copy the active note's document names, reloads the note list, and marks conflict copies in it. Protocol 1.5.**

- **Server.** `NoteSession.fork` makes the incoming file the document's base without touching the document, and queues `keepIncomingAsCopy` behind the vault lock: a flush writes the document over the incoming file (its untouched lines keep the incoming bytes), then the incoming bytes are written with `If-Match` on their own revision, which the stale-write rule turns into a conflict copy. No new vault API: the copy is an ordinary stale write. A conflict that arrives in the pull of a flush takes the same path. Typing after the fork stays in the note.
- **Protocol.** `meta.conflictCopy` keeps its name and shape; what it names changed, so the version is 1.5 and `docs/web/protocol.md` says which side a copy holds since when. Clients only display it.
- **Notice.** `ConflictCopyNotice`, rendered next to the web sync pill, shows "Conflict copy saved" and the copy's file name until closed; a later copy shows it again. A new copy dispatches `memoria:vault-entries-stale` (`src/lib/vaultEntriesStale.ts`), which `useVaultLoader` answers with a reload, so the copy appears in the note list without a page reload and without changing `App.tsx`. PostHog: `web_conflict_copy_notice_shown`, `web_conflict_copy_notice_dismissed`.
- **Note list.** `ConflictCopyBadge` marks a row whose path has the server's conflict-copy name, `<name> (conflict YYYY-MM-DD HHMM[ n])<ext>`, in the remote web build only. The desktop app does not change.
- **Rename and delete.** Unchanged and now documented: a rename pulled from git moves the open document with the note (same `docId`, edits kept, next flush to the new path); a deletion closes the room with `4410` after writing unwritten edits back, which restores the note.

## Consequences

- People editing on the web never see their paragraph replaced by a pull; the desktop finds its version as a conflict copy on its next pull, as for any stale write.
- A fork makes two commits (the document, then the copy) instead of one.
- The web client does not yet react to `4410` or show a notice for a rename pulled from git; it keeps the list up to date on its next load. Follow-up work.
