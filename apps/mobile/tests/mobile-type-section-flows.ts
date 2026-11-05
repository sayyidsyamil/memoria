import { expect, type Locator, type Page } from '@playwright/test'
import { createTitledNoteFromQuickOpen } from './mobile-note-create-actions'

export async function createRenameAndDeleteTypeSection(page: Page) {
  await page.getByTestId('sidebar-section-create-types').click()
  await expect(page.getByTestId('workspace-create-type-name-input')).toBeVisible()
  await page.getByTestId('workspace-create-type-name-input').fill('Decision')
  await page.getByTestId('workspace-action-sheet-createType').getByRole('button', { exact: true, name: 'Create' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()

  const decisionSection = page.getByTestId('sidebar-item-type-decision')
  await expect(decisionSection).toContainText('Decisions')
  await expect(decisionSection.getByTestId('sidebar-item-type-decision-count')).toHaveText('0')
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Decisions')
  await expect(page.getByTestId('note-list-toolbar-subtitle')).toHaveCount(0)

  await longPressTestId(page, 'sidebar-item-type-decision')
  await expect(page.getByTestId('workspace-action-sheet-editTypeSection')).toBeVisible()
  await expect(page.getByTestId('workspace-type-section-type-name-input')).toHaveValue('Decision')
  await page.getByTestId('workspace-type-section-type-name-input').fill('Initiative')
  await page.getByTestId('workspace-action-sheet-editTypeSection').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(decisionSection).toBeHidden()

  const initiativeSection = page.getByTestId('sidebar-item-type-initiative')
  await expect(initiativeSection).toContainText('Initiatives')
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Initiatives')

  await longPressTestId(page, 'sidebar-item-type-initiative')
  await expect(page.getByTestId('workspace-action-sheet-editTypeSection')).toBeVisible()
  await page.getByTestId('workspace-delete-type-action').click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(initiativeSection).toBeHidden()
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Inbox')
}

export async function customizeProcedureTypeSection(page: Page) {
  await longPressTestId(page, 'sidebar-item-procedures')
  const sheet = page.getByTestId('workspace-action-sheet-editTypeSection')
  await expect(sheet).toBeVisible()
  await expect(page.getByTestId('workspace-type-section-type-name-input')).toHaveValue('Procedure')
  await expect(page.getByTestId('workspace-type-section-label-input')).toHaveValue('Procedures')
  await page.getByTestId('workspace-type-section-label-input').fill('Runbooks')
  await page.getByTestId('workspace-move-type-up-action').click()
  await page.getByTestId('workspace-type-icon-folder').click()
  await page.getByTestId('workspace-type-tone-green').click()
  await expect(page.getByTestId('workspace-type-selected-icon')).toContainText('folder')
  await expect(page.getByTestId('workspace-type-selected-color')).toContainText('green')
  await page.getByTestId('workspace-type-sort-custom-field-input').fill('Priority')
  await page.getByTestId('workspace-type-sort-custom-desc').click()
  await page.getByTestId('workspace-type-template-input').fill('## Checklist\n\nTemplate body from the Procedure type.')
  await page.getByTestId('workspace-type-property-search-input').fill('bel')
  await page.getByTestId('workspace-type-property-option-belongs-to').click()
  await page.getByTestId('workspace-type-schema-property-name-input').scrollIntoViewIfNeeded()
  await page.getByTestId('workspace-type-schema-property-name-suggestion-url').click()
  await page.getByTestId('workspace-type-schema-property-value-input').fill('https://example.com/runbook')
  await sheet.getByRole('button', { name: 'Add property' }).click()
  await expect(page.getByTestId('workspace-type-schema-property-url')).toContainText('https://example.com/runbook')
  await page.getByTestId('workspace-type-schema-property-name-input').fill('Priority')
  await page.getByTestId('workspace-type-schema-property-value-input').fill('High')
  await sheet.getByRole('button', { name: 'Add property' }).click()
  await expect(page.getByTestId('workspace-type-schema-property-priority')).toContainText('High')
  await page.getByTestId('workspace-type-schema-relationship-name-suggestion-belongs-to').click()
  await page.getByTestId('workspace-type-schema-relationship-target-input').fill('Workflow Orchestration Essay')
  await sheet.getByRole('button', { name: 'Add relationship' }).click()
  await expect(page.getByTestId('workspace-type-schema-relationship-belongs-to')).toContainText('Workflow Orchestration Essay')
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()

  const runbooksSection = page.getByTestId('sidebar-item-procedures')
  await assertRunbooksSectionMovedAboveEssays(page, runbooksSection)
  await assertProcedureTypeSettingsPersist(page)
  await createRunbookFromTypeDefaults(page, runbooksSection)
}

async function assertRunbooksSectionMovedAboveEssays(page: Page, runbooksSection: Locator) {
  const essaysSection = page.getByTestId('sidebar-item-essays')
  await expect(runbooksSection).toContainText('Runbooks')
  await expect(await rowY(runbooksSection)).toBeLessThan(await rowY(essaysSection))
}

async function assertProcedureTypeSettingsPersist(page: Page) {
  await longPressTestId(page, 'sidebar-item-procedures')
  await expect(page.getByTestId('workspace-type-selected-icon')).toContainText('folder')
  await expect(page.getByTestId('workspace-type-selected-color')).toContainText('green')
  await expect(page.getByTestId('workspace-type-sort-custom-field-input')).toHaveValue('Priority')
  await page.getByTestId('workspace-action-sheet-toolbar').getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
}

async function createRunbookFromTypeDefaults(page: Page, runbooksSection: Locator) {
  await runbooksSection.click()
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Runbooks')
  await expect(page.getByTestId('note-row-open-source-project').getByText('Project Board')).toBeVisible()
  await createTitledNoteFromQuickOpen(page, 'Runbook From Type Defaults')
  await expect(page.getByTestId('note-row-runbook-from-type-defaults.md')).toBeVisible()
  await expect(page.getByTestId('property-row-priority')).toContainText('High')
  await expect(page.getByTestId('relationship-row-workflow-orchestration-essay')).toBeVisible()
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/## Checklist/u)
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/Template body from the Procedure type\./u)
}

async function longPressTestId(page: Page, testId: string) {
  const target = page.getByTestId(testId)
  const box = await target.boundingBox()
  if (!box) throw new Error(`Cannot long-press missing target: ${testId}`)

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(700)
  await page.mouse.up()
}

async function rowY(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Cannot measure missing sidebar row.')
  return box.y
}
