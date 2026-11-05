# ADR-0189: Mobile TenTap Aligned Table Metadata

## Status

Accepted

## Context

ADR-0262 registered native TenTap/Tiptap table nodes for mobile, but kept explicitly aligned Markdown tables source-backed because unannotated table cells would lose desktop divider alignment on save.

The mobile editor now needs more of the desktop table surface to be real WYSIWYG behavior. Alignment is a durable Markdown property, not visual-only chrome: `:---`, `:---:`, and `---:` must survive hydration, native editing, row/column commands, and serialization.

## Decision

Extend the mobile Tiptap table cell and header nodes with a Memoria-owned `memoriaAlignment` attribute parsed from `data-memoria-alignment` / `text-align`, then serialize structured table cells back through the desktop-compatible Markdown table source builder.

Aligned Markdown tables now hydrate as native TenTap table nodes instead of source-backed paragraphs when the table itself is otherwise desktop-compatible. Unsupported table syntax still remains source-backed rather than lossy.

## Consequences

- Mobile WYSIWYG can edit aligned tables as structured tables without silently dropping divider syntax.
- The generated TenTap HTML remains part of the bridge contract and must be rebuilt when table attributes change.
- The source-backed table More sheet remains useful for explicit table shape/alignment edits and for table forms mobile still cannot model safely.
- Future table features such as per-cell formatting or richer column controls should preserve the same Markdown-first alignment contract.
