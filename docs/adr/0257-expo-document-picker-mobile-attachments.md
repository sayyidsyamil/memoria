# ADR-0257: Expo Document Picker for Mobile Attachments

## Status

Accepted

## Context

Desktop Memoria can import files into a vault's `attachments/` directory and keep note Markdown portable by referencing those vault-relative paths. The mobile WYSIWYG editor already preserved existing attachment links and images, but users could not insert a new file from iOS or Android.

The mobile foundation needs the same user-visible behavior without depending on Tauri commands or device-local file URIs. Expo SDK 54 already provides the object-based `expo-file-system` API for vault reads and writes, but selecting a user file requires a platform document picker.

## Decision

Use `expo-document-picker` for mobile attachment selection and copy selected files into the active vault with `expo-file-system`.

The integration is isolated behind `apps/mobile/src/workspace/mobileAttachmentImport.native.ts`. The wrapper:

- requests a single file with `copyToCacheDirectory: true` so Expo FileSystem can read it immediately;
- creates the vault `attachments/` directory through the Expo FileSystem object API;
- writes a timestamp-prefixed sanitized filename to avoid collisions and unsafe path segments;
- returns a vault-relative `attachments/...` path instead of leaking device-local URIs into Markdown.

The web/test fallback importer remains a no-op, and editor surfaces receive only an importer callback plus pure attachment payloads. Screens and source/WYSIWYG editor components do not import `expo-document-picker` directly.

## Consequences

- Native mobile editing can insert image attachments as Markdown image blocks and other files as Markdown links, matching desktop's portable vault contract.
- The feature requires `expo-document-picker` in the mobile Expo app but remains compatible with Expo Go SDK 54.
- Large-file performance depends on the platform picker copying the file into cache before the vault copy. This is acceptable for the foundation slice; if mobile attachment workflows need large video/audio handling, Memoria should design progress UI and limits explicitly.
- Opening existing attachment links on mobile remains a separate follow-up from inserting new attachments.
