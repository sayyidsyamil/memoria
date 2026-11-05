# ADR-0262: Mobile TenTap Table Node

## Status

Accepted

## Context

The mobile WYSIWYG editor is moving toward desktop editor parity before any phone/tablet-specific simplification. Markdown tables are part of the desktop editing surface and should not remain plain source-backed paragraphs for common cases.

TenTap's mobile StarterKit does not register Tiptap's table schema. Inserting or hydrating a table JSON node without registering that schema can invalidate the WebView document, and a custom local table node would create an editor primitive that diverges from the desktop/Tiptap model.

Markdown alignment metadata still needs explicit round-trip support. If mobile hydrates aligned Markdown tables into unannotated cells, it can silently lose left, center, or right alignment on save.

## Decision

Declare `@tiptap/extension-table` as a direct `@memoria/mobile` dependency and register `Table`, `TableRow`, `TableHeader`, and `TableCell` through a Memoria-owned `MobileTableBridge`.

Simple Markdown tables with default divider alignment hydrate as native TenTap/Tiptap table nodes and serialize back to desktop Markdown tables. Tables with explicit alignment stay source-backed until mobile can represent and persist alignment without loss.

## Consequences

- Native WYSIWYG table insertion can use real Tiptap table nodes instead of source-backed paragraph text.
- Simulator/device QA can assert that inserted tables remain structured before save.
- The generated TenTap HTML remains a committed artifact and must be rebuilt when bridge registration changes.
- Aligned Markdown tables remain editable and durable through the source-backed fallback until a richer native table model exists.
