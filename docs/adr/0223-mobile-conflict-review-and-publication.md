# ADR 0223: Mobile conflict review and publication

Status: Accepted, 2026-10-13.

## Context

Mobile users need to resolve diverged Git histories and linked-folder conflicts
without a desktop. Resolution must not discard newer edits or undecided files.

## Decision

- Present one native review surface with explicit local, remote and keep-both
  choices. Show bounded text comparisons and identify binary/deleted entries.
  Revalidate the complete reviewed versions before applying choices.
- Git uses isomorphic-git object APIs and its existing diff3 implementation
  (now a direct dependency) to retain independent changes. Invalid synthesized
  metadata becomes a conflict. Explicit choices copy an original unchanged.
  Merge commits retain both parents and use the existing checkout journal.
- Prepare file/directory swaps separately: isomorphic-git's checkout planner
  emits swap operations that its executor does not implement. Only remove
  verified original tracked bytes, reject untracked children, and retain the
  original objects and journal for recovery. Never force checkout or push.
- Linked folders stage a complete result and retain both original snapshots in
  app-private recovery storage. A journal precedes either side's publication.
  Resume only entries matching the original or intended result. A newer explicit
  review may supersede a blocked journal; its backups are retained.
- UI actions reuse Memoria/RNR controls, desktop conflict-resolution semantics,
  existing localization, theme tokens, and opt-in sync analytics. No note content,
  path, credential or repository name is sent in resolution analytics.

## Consequences

Conflict resolution is intentionally conservative and can require another review
after concurrent changes. Keep-both uses collision-checked sibling names. Git
originals remain in merge history; linked-folder backups consume additional local
space and currently remain until the app's data is removed. Unrelated histories
and ambiguous merge bases remain blocked, never guessed. The physical iCloud
delivery state cannot be inferred from a successful coordinated folder write.
