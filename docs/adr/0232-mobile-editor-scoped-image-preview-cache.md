---
type: ADR
id: "0232"
title: "Scoped disposable image previews for the mobile editor"
status: active
date: 2026-10-17
---

Platform: mobile

## Context

The native TenTap editor runs in a WebView. Inline HTML cannot read arbitrary
vault files on iOS. Loading the editor shell from a cache file while granting
read access only to the vault also fails: WebKit rejects the shell itself as
outside its sandbox. Granting access to the whole application container would
expose unrelated vaults and application files. Writing the shell into a vault
would pollute user data and sync.

## Decision

Create a disposable cache directory per mounted editor. Copy the bundled editor
shell and only the local images referenced by the rendered note into that
directory. Load the shell by file URL and scope WebView read access to that
preview directory. Keep universal file access disabled, and allow navigation
only to the shell or `about:blank`. Remote image behavior remains unchanged.

Reuse the existing attachment-path validation and Markdown renderer. Reject
traversal and outside-vault paths. Preserve relative image URLs in the Tiptap
document, so saving never writes cache paths or base64 image data into Markdown.
Attachment links retain their existing active-vault resolution. Newly imported
images are staged before insertion through the existing import workflow.

Preparation is serialized per editor; images already copied are not recopied
during autosave. Missing images do not prevent editing the note. A shell-cache
failure falls back to the inline text editor. Unmount cleanup waits for pending
copies before deleting only that editor's preview. The first preparation in a
new process removes abandoned previews from the dedicated app-owned cache
namespace. Neither preparation nor cleanup writes into any vault.

## Consequences

Opening a note with local images requires sequential filesystem copies
of its referenced images, not a vault scan or base64 transfer over the JS bridge.
The copies consume transient cache space and are not authoritative data. Tests
must cover missing files, path rejection, pending-copy cleanup, native rendering,
portable serialization, and keyboard focus through autosave on phone and tablet.

This decision extends ADR 0255's native editor integration and follows ADR 0024's
separation of generated caches from user vaults. It does not introduce a network
server, a new dependency, or a new attachment storage format.
