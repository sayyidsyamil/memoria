# 0278: Desktop Note Saves Use UTF-8 Byte Transport

Date: 2026-10-22
Status: Accepted
Platform: desktop

## Context

TOL-142 reports an out-of-memory rejection in JSON serialization after image
interaction and typing. Desktop note persistence passed the entire Markdown
source to Tauri as a JSON argument. Embedded images can make that source very
large, requiring another escaped JavaScript string during each save.

## Decision

Send desktop note content exceeding 256 Ki characters as a raw UTF-8 byte body to `save_note_content_bytes`.
Send only the small note path in the `x-memoria-note-path` header, encoded as
base64 UTF-8 so Unicode filenames remain valid HTTP header values. Reject JSON
bodies, invalid UTF-8 and malformed path headers before writing. Delegate to the
existing save command and its active-vault validation, off-thread writer and
atomic file replacement. The browser fixture backend keeps its JSON API.

## Consequences

The desktop bridge JSON-stringifies only notes up to 256 Ki characters. Larger
note/image content uses bytes. Encoding and
native decoding still require memory proportional to Markdown length; this is
not streaming persistence or a guarantee for arbitrarily large documents. Image
files referenced by attachment paths do not enter the note payload. The existing
JSON command remains available to other callers. No dependencies, storage format,
mobile transport, autosave timing or save acknowledgement semantics change.

The original production event has not been reproduced with its missing source
note; stable-release Sentry follow-up remains necessary to confirm resolution.
