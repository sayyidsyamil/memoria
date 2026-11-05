---
type: ADR
id: "0233"
title: "Offline source-preserving mobile diagram previews"
status: active
date: 2026-10-17
---

Platform: mobile

## Context

Desktop notes contain Mermaid and tldraw fenced blocks. Treating those blocks as
ordinary editable code can lose their fence metadata. Rendering them must not
replace the original snapshot or require a network service. Loading both engines
in every note would penalize ordinary editing and startup.

## Decision

Represent complete Mermaid and tldraw fences as atomic TenTap nodes whose sole
authoritative attribute is the original source. The Markdown serializer returns
that source verbatim. Unsupported, unfinished, or invalid diagrams retain a
source fallback; raw editing remains available.

Bundle the already-used desktop Mermaid library into a separate offline HTML
asset. Stage it only for diagram-containing
notes inside ADR 0232's disposable editor cache. Ordinary notes neither copy nor
parse the engine bundle. A visible diagram lazily starts one renderer iframe per
editor, with serialized jobs and bounded request/result sizes. Whiteboards retain
source fallback: tldraw's export pipeline needs nested same-origin frame access,
which is incompatible with this sandbox. Do not weaken isolation to enable it.

The iframe has an opaque origin, only the scripts sandbox capability, and a strict
Content Security Policy without network access. WebView navigation permits its
exact cache URL only as a subframe. A content-free port-transfer handshake checks
the expected parent window and origin. Typed source and result messages travel
only over that private MessageChannel. Rendered SVG is a Blob-backed image,
never injected as active document markup. Renderer timeouts and failures leave
the source visible. Removing the editor rejects pending work and releases caches,
observers, iframe, and image URLs. Rendering does not focus or mutate the editor.

## Consequences

Mermaid diagrams are read-only previews in rich mode, editable in raw mode.
Whiteboard rendering is deferred, with original snapshot JSON retained. The
optional generated asset adds package
size but not ordinary-note editor load cost. Its build is explicit:
`node --experimental-strip-types apps/mobile/scripts/build-diagram-renderer.ts`,
followed by the existing WYSIWYG HTML generator for editor-source changes.

Native iPhone and iPad checks must exercise actual WebKit rendering, source
preservation, and editor focus rather than treating browser proof as native QA.
No dependency, vault format, or storage authority changes. The rejected tldraw
prototype is not included in the application bundle.
