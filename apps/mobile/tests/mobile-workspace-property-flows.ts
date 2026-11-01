import { expect } from '@playwright/test'
import { MOBILE_PDF_EXPORT_ATTEMPTS_GLOBAL_KEY } from '../src/workspace/mobilePdfExport'
import { createTitledNoteFromQuickOpen, noteRowSlug } from './mobile-note-create-actions'
import type { Page as PageLike } from '@playwright/test'
import { latestClipboardAttempt } from './mobile-browser-attempts'

export async function searchAndSelectRelease(page: PageLike) {
  await page.getByTestId('note-list-search-action').click()
  await expect(page.getByTestId('workspace-search-input')).toBeVisible()
  await expect(page.getByTestId('workspace-search-input')).toBeFocused()
  await expect(page.getByTestId('workspace-search-result-workflow-orchestration')).toBeVisible()
  await page.getByTestId('workspace-search-input').fill('zzzzzzz')
  await expect(page.getByTestId('workspace-search-results').getByText('No matching notes')).toBeVisible()
  await page.getByTestId('workspace-search-input').fill('Release')
  await expect(page.getByTestId('workspace-search-result-release-2026-05-02')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId('note-list-toolbar-subtitle')).toHaveCount(0)
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText('v2026-05-02.md')
}

export async function toggleFavorite(page: PageLike) {
  await page.getByTestId('editor-favorite-action').click()
  await expect(page.getByTestId('editor-favorite-action')).toHaveAccessibleName('Remove from Favorites')
}

export async function retargetSelectedRelease(page: PageLike) {
  await changeSelectedReleaseType(page)
  await editSelectedReleaseStatus(page)
  await editSelectedReleaseTags(page)
  await addTypedProperties(page)
  await moveAndRenameSelectedRelease(page)
  await assertSelectedReleaseDeepLink(page)
  await assertSelectedReleasePdfExport(page)
}

async function changeSelectedReleaseType(page: PageLike) {
  await page.getByTestId('property-row-type-edit').click()
  await expect(page.getByTestId('workspace-change-type-input')).toBeVisible()
  await expect(page.getByTestId('workspace-change-type-input')).toHaveValue('Release')
  await page.getByTestId('workspace-change-type-input').fill('Proc')
  await page.getByTestId('workspace-change-type-suggestion-procedure').click()
  await page.getByTestId('workspace-action-sheet-changeNoteType').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId('property-row-type')).toContainText('Procedure')
}

async function editSelectedReleaseStatus(page: PageLike) {
  await page.getByTestId('property-row-status-edit').click()
  await expect(page.getByTestId('workspace-action-sheet-editProperty')).toBeVisible()
  await expect(page.getByTestId('workspace-property-name-input')).toHaveValue('Status')
  await expect(page.getByTestId('workspace-property-status-picker')).toBeVisible()
  await expect(page.getByTestId('workspace-property-status-shipped')).toBeVisible()
  await expect(page.getByTestId('workspace-property-value-input')).toHaveValue('Shipped')
  await page.getByTestId('workspace-property-value-input').fill('Active')
  await page.getByTestId('workspace-action-sheet-editProperty').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('property-row-status')).toContainText('Active')
}

async function editSelectedReleaseTags(page: PageLike) {
  await page.getByTestId('property-tags-edit').click()
  await expect(page.getByTestId('workspace-property-name-input')).toHaveValue('tags')
  await expect(page.getByTestId('workspace-property-kind-list')).toBeVisible()
  await expect(page.getByTestId('workspace-property-value-input')).toHaveValue('Memoria MVP')
  await page.getByTestId('workspace-property-value-input').fill('Memoria MVP, De')
  await page.getByTestId('workspace-property-value-suggestion-design').click()
  await expect(page.getByTestId('workspace-property-value-input')).toHaveValue('Memoria MVP, Design')
  await page.getByTestId('workspace-action-sheet-editProperty').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('property-tags-wrap')).toContainText('Design')
}

async function addTypedProperties(page: PageLike) {
  await page.getByTestId('property-action-add-property').click()
  await expect(page.getByTestId('workspace-property-name-input')).toBeVisible()
  await page.getByTestId('workspace-property-name-input').fill('Estimate')
  await page.getByTestId('workspace-property-kind-number').click()
  await page.getByTestId('workspace-property-value-input').fill('13')
  await page.getByTestId('workspace-action-sheet-addProperty').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('property-row-estimate')).toContainText('13')

  await page.getByTestId('property-action-add-property').click()
  await page.getByTestId('workspace-property-name-input').fill('Published')
  await page.getByTestId('workspace-property-kind-boolean').click()
  await expect(page.getByTestId('workspace-property-boolean-picker')).toBeVisible()
  await page.getByTestId('workspace-property-boolean-no').click()
  await page.getByTestId('workspace-action-sheet-addProperty').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('property-row-published')).toContainText('No')

  await page.getByTestId('property-action-add-property').click()
  await page.getByTestId('workspace-property-name-input').fill('URL')
  await expect(page.getByTestId('workspace-property-kind-url')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('workspace-property-value-input')).toHaveAttribute('placeholder', 'https://')
  await page.getByTestId('workspace-property-value-input').fill('https://memoria.app')
  await page.getByTestId('workspace-action-sheet-addProperty').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('property-row-url')).toContainText('https://memoria.app')

  await page.getByTestId('property-action-add-property').click()
  await page.getByTestId('workspace-property-name-input').fill('Brand color')
  await expect(page.getByTestId('workspace-property-kind-color')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('workspace-property-color-picker')).toBeVisible()
  await page.getByTestId('workspace-property-color-blue').click()
  await page.getByTestId('workspace-action-sheet-addProperty').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('property-row-brand-color')).toContainText('#155DFF')
}

async function moveAndRenameSelectedRelease(page: PageLike) {
  await page.getByTestId('editor-more-action').click()
  await page.getByTestId('workspace-action-group-file').click()
  await expect(page.getByTestId('workspace-action-move-note-folder')).toBeVisible()
  await page.getByTestId('workspace-action-move-note-folder').click()
  await expect(page.getByTestId('workspace-move-folder-input')).toBeVisible()
  await page.getByTestId('workspace-move-folder-input').fill('Missing Folder')
  await expect(page.getByTestId('workspace-action-sheet-moveNoteToFolder').getByRole('button', { name: 'Save' })).toBeDisabled()
  await page.getByTestId('workspace-move-folder-input').fill('Memoria')
  await page.getByTestId('workspace-move-folder-suggestion-memoria-mobile-ui').click()
  const moveSaveButton = page.getByTestId('workspace-action-sheet-moveNoteToFolder').getByRole('button', { name: 'Save' })
  await expect(moveSaveButton).toBeEnabled()
  await moveSaveButton.click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()

  await page.getByTestId('editor-more-action').click()
  await page.getByTestId('workspace-action-group-file').click()
  await page.getByTestId('workspace-action-rename-file').click()
  await expect(page.getByTestId('workspace-rename-file-input')).toHaveValue('v2026-05-02')
  const renameSaveButton = page.getByTestId('workspace-action-sheet-renameNoteFile').getByRole('button', { name: 'Save' })
  await page.getByTestId('workspace-rename-file-input').fill('Workflow Orchestration Essay')
  await expect(renameSaveButton).toBeDisabled()
  await page.getByTestId('workspace-rename-file-input').fill('quarterly:plan')
  await expect(renameSaveButton).toBeDisabled()
  await page.getByTestId('workspace-rename-file-input').fill('release-cleanup')
  await expect(renameSaveButton).toBeEnabled()
  await renameSaveButton.click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
}

export async function renameSelectedFileToTitle(page: PageLike) {
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText('Workflow Orchestration Essay.md')
  await page.getByTestId('editor-more-action').click()
  await page.getByTestId('workspace-action-group-file').click()
  await expect(page.getByTestId('workspace-action-rename-file-to-title')).toBeVisible()
  await page.getByTestId('workspace-action-rename-file-to-title').click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId('note-row-workflow-orchestration')).toBeVisible()

  await page.getByTestId('editor-more-action').click()
  await page.getByTestId('workspace-action-group-file').click()
  await page.getByTestId('workspace-action-copy-deep-link').click()
  await expect(latestClipboardAttempt(page)).resolves.toBe('memoria://tv/Memoria/Mobile%20UI/workflow-orchestration-essay.md')
}

async function assertSelectedReleaseDeepLink(page: PageLike) {
  await page.getByTestId('editor-more-action').click()
  await page.getByTestId('workspace-action-group-file').click()
  await page.getByTestId('workspace-action-copy-deep-link').click()
  await expect(latestClipboardAttempt(page)).resolves.toBe('memoria://tv/Memoria/Mobile%20UI/release-cleanup.md')
}

async function assertSelectedReleasePdfExport(page: PageLike) {
  await page.getByTestId('editor-more-action').click()
  await page.getByTestId('workspace-action-group-file').click()
  await page.getByTestId('workspace-action-export-pdf').click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.evaluate((key) => {
    const attempts = (window as unknown as Record<string, unknown>)[key]
    const latest = Array.isArray(attempts) ? attempts.at(-1) : null
    return latest && typeof latest === 'object'
      ? (latest as { fileName?: unknown }).fileName
      : null
  }, MOBILE_PDF_EXPORT_ATTEMPTS_GLOBAL_KEY)).resolves.toBe('release-cleanup.pdf')
}

export async function createMobileQaDraft(page: PageLike) {
  await createNote(page, 'Mobile QA Draft', 'mobile-qa-draft.md')
}

export async function toggleSelectedNoteWidth(page: PageLike) {
  await page.getByTestId('editor-more-action').click()
  await expect(page.getByText('Switch to wide note width')).toBeVisible()
  await page.getByTestId('workspace-action-toggle-note-width').click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()

  await page.getByTestId('editor-more-action').click()
  await expect(page.getByText('Switch to normal note width')).toBeVisible()
  await page.getByTestId('workspace-action-sheet-toolbar').getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
}

export async function createNote(page: PageLike, title: string, rowId: string) {
  await createTitledNoteFromQuickOpen(page, title, `note-row-${rowId}`)
  await expectSelectedBodyOnlyNoteTitle(page, title)
}

export async function expectSelectedBodyOnlyNoteTitle(page: PageLike, title: string) {
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText(`${noteRowSlug(title)}.md`)
  await expect(page.getByTestId('editor-title')).toBeHidden()
}

export async function expectSelectedChromeTitle(page: PageLike, title: string) {
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText(title)
}

export async function changeSelectedNoteTypeTo(page: PageLike, type: string) {
  await page.getByTestId('property-row-type-edit').click()
  await expect(page.getByTestId('workspace-change-type-input')).toBeVisible()
  await page.getByTestId('workspace-change-type-input').fill(type)
  await page.getByTestId('workspace-action-sheet-changeNoteType').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId('property-row-type')).toContainText(type)
}

export async function insertPersonMention(page: PageLike) {
  const input = await ensureMarkdownInput(page)
  await page.getByTestId('editor-markdown-input').fill('# Mention Draft\n\nFollow up with @mar')
  await expect(page.getByTestId('editor-person-mention-suggestions')).toBeVisible()
  await page.getByTestId('editor-person-mention-suggestion-maria-rossi-md').click()
  await expect(input).toHaveValue('# Mention Draft\n\nFollow up with [[maria-rossi]] ')
}

export async function ensureMarkdownInput(page: PageLike) {
  const input = page.getByTestId('editor-markdown-input')
  if (await input.isVisible().catch(() => false)) return input

  await page.getByTestId('editor-source-action').click()
  await expect(input).toBeVisible()
  return input
}
