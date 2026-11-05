# ADR-0261: Mobile TenTap Code Block Node

## Status

Accepted

## Context

The mobile WYSIWYG editor needs to copy desktop editor semantics before adapting interaction details. Simple fenced code blocks are part of that baseline: desktop Memoria treats them as rich editor code blocks and saves them back to durable Markdown fences.

TenTap's mobile StarterKit includes the inline `code` mark, but it does not register Tiptap's block-level `codeBlock` node. Sending a `codeBlock` JSON node into the native editor without registering that schema node can invalidate the document in the WebView, which breaks simulator/device QA and makes the editor fallback less predictable.

Complex Markdown fence metadata, such as tilde fences or info strings with spaces, still needs exact source preservation until mobile has a richer code-block metadata model.

## Decision

Declare `@tiptap/extension-code-block` as a direct `@memoria/mobile` dependency and register it through a Memoria-owned `MobileCodeBlockBridge`.

The bridge is registered in both `MobileWysiwygMarkdownEditor.native.tsx` and the generated TenTap WebView entrypoint. Simple backtick fences with simple language identifiers hydrate as native `codeBlock` nodes and serialize back to Markdown. Complex fence metadata remains source-backed so mobile does not silently lose desktop-compatible source information.

## Consequences

- Native WYSIWYG code-block insertion can use a real TenTap/Tiptap node instead of source-backed paragraphs.
- Simulator/device QA can assert that inserted code blocks remain structured before save.
- The generated TenTap HTML remains a committed artifact and must be rebuilt when bridge registration changes.
- Complex code-fence metadata remains editable and durable through the source-backed fallback until a richer native code-block metadata UI exists.
