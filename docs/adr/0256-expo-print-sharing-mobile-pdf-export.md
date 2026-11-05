# ADR-0256: Expo Print and Sharing for Mobile PDF Export

## Status

Accepted

## Context

The mobile UI foundation already exposes the desktop "Export note as PDF" command in the note more-actions sheet, but the row was still a visible no-op. Desktop PDF export is renderer-owned because it can print the already-rendered BlockNote DOM through Tauri and platform print/PDF APIs.

The Expo mobile app cannot reuse that React DOM/Tauri path. It still needs the same product behavior: export the current note body without YAML frontmatter, leave the vault Markdown unchanged, and keep visual components isolated from native APIs.

## Decision

Use `expo-print` for native HTML-to-PDF generation and `expo-sharing` for handing the generated PDF to the platform share sheet.

The integration is wrapped by `apps/mobile/src/workspace/mobilePdfExport.ts`. The wrapper:

- accepts a `MobileNote` and builds frontmatter-free HTML from the same mobile Markdown body renderer used by the editor;
- keeps the note title as document content only when it exists in the Markdown body, instead of creating a separate mobile-only title field;
- records deterministic export attempts for Playwright and web QA without opening a browser print dialog;
- calls Expo Print and Sharing only from the controller-owned workspace boundary.

`MobileWorkspaceActionSheet` continues to receive an `onExportNoteAsPdf` callback and does not import Expo modules.

## Consequences

- The mobile command is now a real native action on iOS/Android while the web UI lab remains deterministic.
- The PDF output is generated from mobile Markdown HTML, not the live native rich-editor WebView. That is acceptable for this foundation slice but lower fidelity than desktop's rendered-DOM export for advanced blocks.
- Future table, attachment, Mermaid, math, and custom TenTap node support should improve the shared mobile Markdown-to-HTML renderer instead of adding PDF-only rendering paths.
- Exported PDFs are temporary share artifacts; Memoria does not add generated PDFs back into the vault unless a future explicit save-to-vault flow is designed.
