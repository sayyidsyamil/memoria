# Direct import and knowledge review — 1 November 2026

Import files opens an existing pending source directly; otherwise it opens the
file picker once queue storage is ready. Extraction opens text review without
requiring a separate Review click. The user can Skip file, Import only, or
Import & build knowledge. The last option saves evidence first and opens a
single auto-started knowledge build in the existing review component. It never
applies proposed claims automatically.

Knowledge review presents one source at a time, with a source selector only
when multiple reviews exist. Completed work is behind history. Evidence remains
inspectable alongside editable statements. Save changes and Skip source stay in
the fixed footer, so long proposals do not bury the primary actions. After a
source is saved/skipped, the remaining pending source becomes current.

Seven focused tests pass, including direct handoff without automatic claim
publication and one-source-at-a-time selection. TypeScript, scoped lint, diff
check and native build pass. Native Review knowledge was
opened with a real saved pending proposal; the accessibility tree confirms the
editable claims/evidence and footer actions. Screenshot capture did not reliably
render the modal in that session. Full native picker → import → build → apply
acceptance remains separate; existing source data was not applied or rejected
during visual inspection.
