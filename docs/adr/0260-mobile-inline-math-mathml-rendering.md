# ADR-0260: Mobile Inline Math MathML Rendering

## Status

Accepted

## Context

ADR-0259 added a Memoria-owned `mathInline` TenTap node for Expo mobile editing. That closed the structural editor and Markdown persistence contract, but the native editor still displayed inline math as `$latex$` source text. Desktop Memoria renders inline math through KaTeX, and mobile should copy that behavior as far as Expo Go and TenTap allow.

TenTap bridge extensions can provide Tiptap schema nodes and CSS, but the current bridge path does not expose a React node view. Returning raw KaTeX HTML from Tiptap `renderHTML` would be treated as text unless we create DOM manually or convert the output to a ProseMirror DOM spec. Pulling the full KaTeX stylesheet into the native WebView would also add a fragile CSS packaging path.

TenTap's packaged editor HTML only includes TenTap's own bundled bridge extensions. A Memoria-owned Tiptap node must therefore be present in the WebView bundle itself; registering the bridge only on the React Native side is not enough.

## Decision

Add `katex` and `@tiptap/react` as direct `@memoria/mobile` dependencies and render mobile inline math as KaTeX MathML inside the owned `mathInline` bridge.

`MobileWysiwygMathHtml.ts` owns the small KaTeX wrapper and requests `output: "mathml"`, `throwOnError: false`, and `trust: false`. `MobileWysiwygMathBridge.ts` keeps the same `data-type="mathInline"` and `data-latex` attributes for parsing and serialization, but when the WebView DOM is available it creates the inline wrapper element and injects the MathML result. In non-DOM contexts it falls back to the desktop Markdown source string.

`MobileWysiwygTentapWebEditor.tsx` is the Memoria editor entrypoint for TenTap's WebView. `apps/mobile/scripts/build-wysiwyg-editor-html.mjs` bundles that entrypoint into the generated `MobileWysiwygTentapEditorHtml.ts` string, and `MobileWysiwygMarkdownEditor.native.tsx` passes it to TenTap as `customSource`. That keeps Memoria-owned Tiptap nodes inside the WebView bundle while the React Native wrapper remains the only screen-level integration point.

## Consequences

- Native WYSIWYG inline math now renders as a formula instead of source-like `$latex$` text while preserving the desktop Markdown save format.
- The mobile package declares the editor/web dependencies it uses directly, even when desktop or TenTap already pull them transitively.
- The bridge avoids a mobile KaTeX CSS bundle by relying on MathML support in modern iOS and Android webviews.
- The generated TenTap HTML is a committed artifact; changes to custom WebView editor extensions must rerun `node apps/mobile/scripts/build-wysiwyg-editor-html.mjs`.
- Full display-math block editing and rich native table/canvas editing remain separate structured-editor follow-ups.
