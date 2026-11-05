# ADR-0259: Mobile TenTap Inline Math Node

## Status

Accepted

## Context

Desktop Memoria converts completed inline math Markdown such as `$x^2$` into a rich editor math node. The mobile TenTap editor already mirrored desktop arrow ligature and highlight input transforms, but inline math was still plain Markdown source because TenTap's StarterKit does not include Memoria's custom math node.

The mobile foundation needs to keep copy-first editor semantics: mobile should preserve the same durable Markdown source while introducing native editor nodes only when the editor schema can carry them safely. Pushing unsupported JSON into TenTap would make simulator/device behavior fragile.

## Decision

Add an explicit mobile dependency on `@tiptap/core` and define a Memoria-owned `mathInline` TenTap bridge under the mobile editor wrapper.

The bridge is registered by `MobileWysiwygMarkdownEditor` with TenTap's StarterKit, while `mobileInlineMath.ts`, `mobileDocumentContent.ts`, and `mobileWysiwygInputTransforms.ts` own the pure parsing, hydration, transform, and serialization contracts. Mobile inline math keeps the desktop Markdown source (`$latex$`) as the durable save format.

## Consequences

- Mobile WYSIWYG input transforms can create a real `mathInline` node instead of inserting unsupported JSON.
- Initial Markdown hydration and editor JSON serialization both understand the same inline math contract.
- Native simulator QA can assert inline math as a structural proof, not just a visual screenshot.
- This does not yet claim full desktop KaTeX visual fidelity inside TenTap; richer formula rendering can be layered onto the owned bridge without changing the Markdown persistence contract.
