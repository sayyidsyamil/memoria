# 0210: Parse mobile saved views with a YAML library

Date: 2026-10-11
Status: Accepted

## Context

The handwritten mobile parser only recognizes a particular indentation style.
Desktop-generated YAML may use indentless sequences, so real saved views silently
lose their conditions and match all notes despite sharing the filter evaluator.

## Decision

Use the `yaml` package for mobile saved-view syntax. Validate the resulting
filter tree against the existing desktop-compatible mobile contract before
evaluation. Unsupported operators or malformed filters must not become an empty
all group. Bound input size, alias expansion and nesting. Keep the existing
serializer and shared desktop evaluator; do not create another filter language.

## Consequences

Valid YAML formatting no longer changes view semantics. Invalid definitions are
not offered as all-notes views, and files remain untouched on disk. This adds one
pure-JavaScript dependency usable by native Hermes and web. This decision does
not change frontmatter persistence or automatically rewrite existing vaults.

Reference: https://eemeli.org/yaml/
