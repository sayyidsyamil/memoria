# 0216: Remember local imports alongside Git working copies

Date: 2026-10-12
Status: Accepted for the mobile foundation branch
Supersedes: the single-replaceable-copy portion of ADR-0192; extends ADR-0197.

## Decision

Every newly imported folder gets a unique app-owned directory beneath
`Documents/Local Vaults`. The existing recoverable catalog records both Git
working copies and local copies, with exactly one active entry. Local entries
store validated Documents-relative paths, never container UUIDs or credentials.
The original `Documents/Memoria Vault` is registered in place on first migration;
it is not moved, overwritten, or deleted. Initialized empty catalogs do not
resurrect forgotten legacy imports.

Vault switching and forgetting use the existing save/drain/editor barrier.
Forgetting removes catalog metadata only, including its active pointer if needed.
It never removes files, commits changes, pushes, signs out, or revokes access.
The catalog retains its existing validated temporary-file/backup publication and
operation serialization. A failed restore is surfaced, not silently replaced by
another vault.

The native iOS picker copies while provider access is live. Other picker paths
copy into app Documents before registering their selection. These remain local
imports, not live iCloud/provider synchronization. No new dependency or protocol
is introduced. GitHub credentials remain in the existing SecureStore account,
whose controls are also available from Settings.

## Verification

Check backward-compatible migration, distinct local/Git selection, cold-launch
restore, invalid paths, cancelled forget, failed saves, and forget-without-delete.
Use disposable directories for mutation tests; keep the user's vault read-only.
