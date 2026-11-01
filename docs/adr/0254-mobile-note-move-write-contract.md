# ADR-0254: Mobile note move write contract

## Status

Accepted

## Context

The mobile workspace reducer already supported note folder moves and explicit filename renames while rewriting inbound wikilinks in the editable snapshot. The first persistence contract represented those note retargets as `deleteNote` plus `saveNote`, which was acceptable for deterministic fixture tests but did not match Memoria's desktop model for file retargeting.

Desktop note retargeting treats folder moves and filename renames as file moves, with backlink rewrites as separate content saves. Keeping mobile on delete-plus-save would preserve a weaker end state and would make native-vault Expo testing less representative of desktop rename semantics.

## Decision

Mobile note folder moves and explicit filename renames now emit a first-class `moveNote` write with `path` and `toPath`. The moved note content is not rewritten just to move the file. Only notes whose wikilinks or relationship references change emit separate `saveNote` writes.

The native Expo repository persists `moveNote` through the filesystem file-move primitive. Host/browser QA mirrors the same operation by renaming the injected content-map key, so Playwright tests can assert the same write sequence without touching a real vault.

## Consequences

- Mobile note retargeting no longer approximates file moves as delete-plus-save.
- Path-backed selected notes remain selectable after retargeting by reading the `moveNote.toPath` write.
- Backlink rewrite failures can stay isolated to `saveNote` writes instead of being confused with the file move itself.
- Full desktop crash-safe transaction recovery remains a native backend concern; the Expo foundation now has a write contract that can map to that stronger backend later without changing component callbacks.
