# 0220: Validate synthesized mobile merge metadata

Date: 2026-10-13
Status: Accepted for the mobile foundation branch
Extends ADR 0218.

## Decision

Before publishing an automatic Git merge, walk its proposed tree and validate
blobs synthesized from both parents. Markdown frontmatter must parse as a YAML
mapping (or an empty header), without duplicate keys, syntax errors, unsupported
tags or excessive alias expansion. Saved views reuse the existing view parser,
including its filter-tree validation. JSON configuration under `config/` must
parse as an object. Preserve arbitrary valid custom properties without coercion.

Validation reads Git objects only. An invalid candidate leaves HEAD, index and
working files intact and returns divergence for explicit resolution. Both parent
histories retain the originals. Unrelated legacy documents copied unchanged
from either parent are not normalized or newly rejected.

## Consequences

A clean textual merge is not sufficient proof that structured metadata is valid.
Semantic validity beyond the supported schema (for example, whether a user
intended a relationship value) still requires human resolution. No new dependency
or hand-written YAML parser is introduced.
