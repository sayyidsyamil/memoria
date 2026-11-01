# ADR-0255: TenTap Mobile WYSIWYG Editor

## Status

Accepted

## Context

The mobile UI foundation initially used a React Native form with a dedicated note-title input plus a raw Markdown body field. That diverges from Memoria desktop, where the rich editor is the primary editing surface and the note title is optional document content derived from the first H1 when present.

The tablet target needs high visual and interaction parity with desktop before phone-specific reductions. The editor must therefore start from a single document surface, preserve YAML frontmatter outside the editing canvas, and save back to Memoria Markdown without exposing title/body as separate mobile-only fields.

TenTap is a React Native rich-text editor built on Tiptap/ProseMirror. Its documented Expo installation path uses `@10play/tentap-editor` plus `react-native-webview`; Expo Go supports the basic editor path, while advanced customization may require a development client later.

## Decision

Use TenTap as the first native mobile WYSIWYG editor engine for the mobile UI foundation.

The mobile app wraps TenTap behind `MobileWysiwygMarkdownEditor` instead of letting screens depend on TenTap directly. The wrapper owns:

- converting the existing Markdown body to initial editor HTML;
- serializing TenTap JSON back to Markdown;
- preserving YAML frontmatter through a document-content boundary;
- styling the editor WebView with desktop editor tokens;
- keeping the H1/title optional inside the document, with no dedicated mobile title input.

The web/Playwright lane keeps a single-document Markdown fallback so fast browser QA can still exercise editing, wikilink suggestions, and formatting without requiring TenTap's Expo Web shims. Native iOS simulator/device QA is the acceptance path for the real rich editor.

## Consequences

- Mobile editing follows the desktop mental model: one document surface, optional H1 title, frontmatter outside the canvas.
- TenTap is isolated enough that Memoria can replace it if native performance, serialization fidelity, or advanced autocomplete support proves insufficient.
- The editor uses a WebView internally, so simulator/device QA is mandatory for layout, keyboard, and performance checks.
- Full desktop editor parity still requires follow-up slices for richer input transforms, wikilink/person suggestions inside TenTap, table fidelity, attachments, and raw-editor fallback actions.
- Table editing is intentionally not claimed in this slice: TenTap's Expo Go editor source only ships its built-in StarterKit, so table markdown stays visible as editable markdown lines until real table nodes are added through a custom TenTap web editor bundle or a development-client path.
