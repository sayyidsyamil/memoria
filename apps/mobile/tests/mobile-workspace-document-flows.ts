import { expect } from '@playwright/test'
import { createTitledNoteFromQuickOpen } from './mobile-note-create-actions'
import type { Page as PageLike } from '@playwright/test'
import { expectSelectedBodyOnlyNoteTitle, ensureMarkdownInput } from './mobile-workspace-property-flows'
import { longPressRoleButton } from './mobile-workspace-navigation-flows'
import { latestClipboardAttempt } from './mobile-browser-attempts'

export async function addDatePropertyFromSuggestion(page: PageLike) {
  await expect(page.getByTestId('property-placeholder-suggested-date')).toBeVisible()
  await page.getByTestId('property-placeholder-suggested-date').click()
  await expect(page.getByTestId('workspace-property-name-input')).toBeVisible()
  await expect(page.getByTestId('workspace-property-name-input')).toHaveValue('Date')
  await expect(page.getByTestId('workspace-property-kind-date')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('workspace-property-value-input')).toHaveAttribute('placeholder', 'YYYY-MM-DD')
  await page.getByTestId('workspace-property-value-input').fill('2026-06-14')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId('property-row-date')).toContainText('June 14, 2026')
  await page.getByTestId('property-row-date-edit').click()
  await expect(page.getByTestId('workspace-action-sheet-editProperty')).toBeVisible()
  await expect(page.getByTestId('workspace-property-name-input')).toHaveValue('Date')
  await expect(page.getByTestId('workspace-property-value-input')).toHaveValue('2026-06-14')
  await page.getByTestId('workspace-property-value-input').fill('2026-06-15')
  await page.getByTestId('workspace-action-sheet-editProperty').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId('property-row-date')).toContainText('June 15, 2026')
}

export async function addRelationshipFromSuggestion(page: PageLike) {
  await expect(page.getByTestId('relationship-placeholder-suggested-related-to-add')).toBeVisible()
  await page.getByTestId('relationship-placeholder-suggested-related-to-add').click()
  await expect(page.getByTestId('workspace-relationship-name-input')).toBeVisible()
  await expect(page.getByTestId('workspace-relationship-name-input')).toHaveValue('related_to')
  await page.getByTestId('workspace-relationship-note-title-input').fill('Open Source')
  await expect(page.getByTestId('workspace-relationship-note-suggestion-open-source-project')).toBeVisible()
  await expect(page.getByTestId('workspace-relationship-create-target')).toContainText('Open Source')
  await page.getByTestId('workspace-relationship-note-suggestion-open-source-project').click()
  await page.getByTestId('workspace-action-sheet-addRelationship').getByRole('button', { name: 'Add' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId('relationship-row-how-i-run-an-open-source-project')).toBeVisible()
  await page.getByTestId('relationship-row-how-i-run-an-open-source-project-open').click()
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText('How I Run an Open Source Project.md')
  await page.getByTestId('note-row-mobile-qa-draft.md').click()
  await expectSelectedBodyOnlyNoteTitle(page, 'Mobile QA Draft')
  await page.getByTestId('relationship-row-how-i-run-an-open-source-project').getByLabel('Remove').click()
  await expect(page.getByTestId('relationship-row-how-i-run-an-open-source-project')).toBeHidden()

  await page.getByTestId('property-action-add-relationship').click()
  await page.getByTestId('workspace-relationship-key-suggestion-related-to').click()
  await page.getByTestId('workspace-relationship-note-title-input').fill('Brand New Target')
  await expect(page.getByTestId('workspace-relationship-create-target')).toContainText('Brand New Target')
  await page.getByTestId('workspace-relationship-create-target').click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expectSelectedBodyOnlyNoteTitle(page, 'Brand New Target')
  await page.getByTestId('note-row-mobile-qa-draft.md').click()
  await expect(page.getByTestId('relationship-row-brand-new-target')).toBeVisible()
  await page.getByTestId('relationship-row-brand-new-target-open').click()
  await expectSelectedBodyOnlyNoteTitle(page, 'Brand New Target')
  await page.getByTestId('note-row-mobile-qa-draft.md').click()
  await expectSelectedBodyOnlyNoteTitle(page, 'Mobile QA Draft')
}

export async function editMarkdownWithWikilink(page: PageLike) {
  await page.getByTestId('editor-source-action').click()
  await expect(page.getByTestId('editor-markdown-input')).toBeVisible()
  await expect(page.getByTestId('editor-formatting-toolbar')).toBeVisible()
  await page.getByTestId('editor-markdown-input').fill('# Mobile QA Draft Revised\n\nDraft body referencing ')
  await page.getByTestId('editor-format-wikilink').click()
  await expect(page.getByTestId('editor-wikilink-suggestions')).toBeHidden()
  await page.getByTestId('editor-markdown-input').fill('# Mobile QA Draft Revised\n\nDraft body referencing [[o')
  await expect(page.getByTestId('editor-wikilink-suggestions')).toBeHidden()
  await page.getByTestId('editor-markdown-input').fill('# Mobile QA Draft Revised\n\nDraft body referencing [[op')
  await expect(page.getByTestId('editor-wikilink-suggestion-open-source-project')).toBeVisible()
  await page.getByTestId('editor-markdown-input').fill('# Mobile QA Draft Revised\n\nDraft body referencing [[open')
  await expect(page.getByTestId('editor-wikilink-suggestion-open-source-project')).toBeVisible()
  await page.getByTestId('editor-wikilink-suggestion-open-source-project').click()
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue('# Mobile QA Draft Revised\n\nDraft body referencing [[Memoria/Mobile UI/How I Run an Open Source Project]]')
  await page.getByTestId('editor-format-table').click()
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/Column/)
  const formattedMarkdown = await page.getByTestId('editor-markdown-input').inputValue()
  await page.getByTestId('editor-markdown-input').fill([
    formattedMarkdown,
    '',
    '#### Deep detail',
    '',
    '1. First ordered step with [source](https://example.com) and ~~stale copy~~',
    '  1. Nested ordered step',
    '',
    '- [x] Complete the mobile renderer',
    '- [ ] Check native spacing',
    '',
    '```typescript',
    'const renderer = "native";',
    '```',
    '',
    '---',
  ].join('\n'))
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText('mobile-qa-draft.md')
  await expect(page.getByTestId('note-row-mobile-qa-draft.md')).toContainText('Mobile QA Draft Revised')
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/Draft body referencing \[\[Memoria\/Mobile UI\/How I Run an Open Source Project\]\]/u)
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/#### Deep detail/u)
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/const renderer = "native"/u)
}

export async function replaceSelectedNoteMarkdown(page: PageLike, markdown: string) {
  const input = await ensureMarkdownInput(page)
  await input.fill(markdown)
  await expect(input).toHaveValue(markdown)
  await page.waitForTimeout(300)
}

export function tableOfContentsNavigationMarkdown() {
  const leadIn = Array.from({ length: 7 }, (_item, index) => (
    `Paragraph ${index + 1} keeps the mounted editor preview tall enough for outline navigation proof. `
    + 'The target heading must stay within the rendered block budget while still sitting below the initial viewport. '
    + 'This line intentionally wraps across several visual rows in the tablet editor.'
  ))

  return [
    '# TOC Navigation Draft',
    '',
    ...leadIn.flatMap((line) => [line, '']),
    '## Target Section',
    '',
    'The table of contents should scroll to this section.',
    '',
    '### Nested Target',
    '',
    'Nested content stays reachable through the same outline model.',
  ].join('\n')
}

export async function editorScrollTop(page: PageLike) {
  return page.getByTestId('editor-scroll').evaluate((element) => element.scrollTop)
}

export async function editRawFrontmatterContract(page: PageLike) {
  await page.getByTestId('editor-source-action').click()
  await expect(page.getByTestId('editor-markdown-input')).toBeVisible()
  await page.getByTestId('editor-markdown-input').fill([
    '---',
    'type: Procedure',
    'Status: Active',
    'tags:',
    '  - Mobile',
    '  - Parity',
    'Priority: High',
    'related_to:',
    '  - [[Memoria/Mobile UI/How I Run an Open Source Project]]',
    '---',
    '# Raw Frontmatter Contract',
    '',
    'Body with [[Release Notes]].',
    '',
  ].join('\n'))
  await page.getByTestId('editor-source-action').click()

  await expect(page.getByTestId('editor-toolbar-title')).toHaveText('Workflow Orchestration Essay.md')
  await expect(page.getByTestId('note-row-workflow-orchestration')).toContainText('Raw Frontmatter Contract')
  await expect(page.getByTestId('property-row-type')).toContainText('Procedure')
  await expect(page.getByTestId('property-row-status')).toContainText('Active')
  await expect(page.getByTestId('property-tags-wrap')).toContainText('Parity')
  await expect(page.getByTestId('property-row-priority')).toContainText('High')
  await expect(page.getByTestId('relationship-row-how-i-run-an-open-source-project-text')).toHaveText('How I Run an Open Source Project')
}

export async function archiveAndUnarchiveSelectedNote(page: PageLike) {
  await page.getByTestId('editor-more-action').click()
  await expect(page.getByText('Archive Note')).toBeVisible()
  await page.getByTestId('workspace-action-group-file').click()
  await expect(page.getByText('Copy deep link to current item')).toBeVisible()
  await page.getByTestId('workspace-action-copy-deep-link').click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(latestClipboardAttempt(page)).resolves.toBe('memoria://memoria-vault/mobile-qa-draft.md')

  await page.getByTestId('editor-more-action').click()
  await expect(page.getByText('Archive Note')).toBeVisible()
  await page.getByTestId('workspace-action-archive-note').click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId('note-row-mobile-qa-draft.md')).toBeHidden()

  await page.getByTestId('sidebar-item-archive').click()
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Archive')
  await expect(page.getByTestId('note-row-mobile-qa-draft.md')).toBeVisible()
  await page.getByTestId('note-row-mobile-qa-draft.md').click()
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText('mobile-qa-draft.md')

  await page.getByTestId('editor-more-action').click()
  await expect(page.getByText('Unarchive Note')).toBeVisible()
  await page.getByTestId('workspace-action-archive-note').click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId('note-row-mobile-qa-draft.md')).toBeHidden()

  await page.getByRole('button', { name: 'Mobile Inbox View' }).click()
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Mobile Inbox View')
  await expect(page.getByTestId('note-row-mobile-qa-draft.md')).toBeVisible()
  await page.getByTestId('note-row-mobile-qa-draft.md').click()
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText('mobile-qa-draft.md')
}

export async function organizeUnorganizeAndDeleteSelectedDraft(page: PageLike) {
  await page.getByTestId('sidebar-item-inbox').click()
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Inbox')
  await expect(page.getByTestId('note-row-mobile-qa-draft.md')).toBeVisible()
  await page.getByTestId('note-row-mobile-qa-draft.md').click()
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText('mobile-qa-draft.md')

  await page.getByTestId('editor-more-action').click()
  await expect(page.getByText('Mark as Organized')).toBeVisible()
  await page.getByTestId('workspace-action-organize-note').click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId('note-row-mobile-qa-draft.md')).toBeHidden()

  await page.getByTestId('sidebar-item-all-notes').click()
  await expect(page.getByTestId('note-row-mobile-qa-draft.md')).toBeVisible()
  await page.getByTestId('note-row-mobile-qa-draft.md').click()
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText('mobile-qa-draft.md')

  await page.getByTestId('editor-more-action').click()
  await expect(page.getByText('Mark as Unorganized')).toBeVisible()
  await page.getByTestId('workspace-action-organize-note').click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await page.getByTestId('sidebar-item-inbox').click()
  await expect(page.getByTestId('note-row-mobile-qa-draft.md')).toBeVisible()
  await page.getByTestId('note-row-mobile-qa-draft.md').click()
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText('mobile-qa-draft.md')

  await page.getByTestId('editor-more-action').click()
  await expect(page.getByText('Delete Note')).toBeVisible()
  await page.getByTestId('workspace-action-delete-note').click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId('note-row-mobile-qa-draft.md')).toBeHidden()
}

export async function createRenameAndDeleteSidebarFolder(page: PageLike) {
  await page.getByTestId('sidebar-section-create-folders').click()
  await expect(page.getByTestId('workspace-create-folder-name-input')).toBeVisible()
  await page.getByTestId('workspace-create-folder-name-input').fill('Mobile Test Folder')
  await page.getByTestId('workspace-action-sheet-createFolder').getByRole('button', { exact: true, name: 'Create' }).click()
  await expect(page.getByRole('button', { name: 'Mobile Test Folder' })).toBeVisible()
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Mobile Test Folder')

  await longPressRoleButton(page, 'Mobile Test Folder')
  await expect(page.getByTestId('workspace-rename-folder-input')).toHaveValue('Mobile Test Folder')
  await page.getByTestId('workspace-rename-folder-input').fill('Mobile Renamed Folder')
  await page.getByTestId('workspace-action-sheet-editFolder').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('button', { name: 'Mobile Renamed Folder' })).toBeVisible()
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Mobile Renamed Folder')

  await longPressRoleButton(page, 'Mobile Renamed Folder')
  await page.getByTestId('workspace-action-copy-folder-path').click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(latestClipboardAttempt(page)).resolves.toBe('Mobile Renamed Folder')

  await createTitledNoteFromQuickOpen(page, 'Folder Context Draft', 'note-row-Mobile Renamed Folder/folder-context-draft.md')
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Mobile Renamed Folder')

  await longPressRoleButton(page, 'Mobile Renamed Folder')
  await page.getByTestId('workspace-action-create-child-folder').click()
  await page.getByTestId('workspace-create-folder-name-input').fill('Child Folder')
  await page.getByTestId('workspace-action-sheet-createFolder').getByRole('button', { exact: true, name: 'Create' }).click()
  await expect(page.getByRole('button', { name: 'Child Folder' })).toBeVisible()
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Child Folder')

  await longPressRoleButton(page, 'Child Folder')
  await page.getByTestId('workspace-action-delete-folder').click()
  await expect(page.getByRole('button', { name: 'Child Folder' })).toBeHidden()

  await longPressRoleButton(page, 'Mobile Renamed Folder')
  await page.getByTestId('workspace-action-delete-folder').click()
  await expect(page.getByRole('button', { name: 'Mobile Renamed Folder' })).toBeHidden()
}
