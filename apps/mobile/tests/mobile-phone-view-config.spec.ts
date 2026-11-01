import { openPhoneProperties, openPhoneSidebar, phoneBack } from './mobile-panel-navigation'
import { expect, test, type Page } from '@playwright/test'
import { longPressTestId } from './mobile-phone-test-gestures'

test.describe('phone saved view configuration parity', () => {
  test('creates, edits, and deletes a filtered phone saved view', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-portrait', 'Phone saved-view configuration runs through the phone sidebar drawer.')

    await page.goto('/')
    await openPhoneSidebar(page)
    await page.getByTestId('sidebar-section-create-views').click()
    await expect(page.getByTestId('workspace-create-view-name-input')).toHaveValue('')
    await expect(page.getByTestId('workspace-view-filter-value-input-0')).toHaveValue('')
    await page.getByTestId('workspace-view-filter-value-input-0').fill('Essay')
    await page.getByTestId('workspace-create-view-name-input').fill('Phone Essay View')
    await page.getByTestId('workspace-action-sheet-createView').getByRole('button', { exact: true, name: 'Create' }).click()
    await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()

    await openPhoneSidebar(page)
    await page.getByTestId('sidebar-item-view-phone-essay-view').click()
    await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Phone Essay View')
    await expect(page.getByTestId('note-row-workflow-orchestration')).toBeVisible()
    await expect(page.getByTestId('note-row-open-source-project')).toBeHidden()

    await openPhoneSidebar(page)
    await page.getByTestId('sidebar-item-inbox').click()
    await openPhoneSidebar(page)
    await longPressTestId(page, 'sidebar-item-view-phone-essay-view')
    await expect(page.getByTestId('workspace-edit-view-name-input')).toHaveValue('Phone Essay View')
    await expect(page.getByTestId('workspace-view-filter-value-input-0')).toHaveValue('Essay')
    await page.getByTestId('workspace-edit-view-name-input').fill('Phone Procedure View')
    await page.getByTestId('workspace-view-filter-value-input-0').fill('Procedure')
    await page.getByTestId('workspace-action-sheet-editView').getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
    await openPhoneSidebar(page)
    await page.getByTestId('sidebar-item-view-phone-essay-view').click()
    await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Phone Procedure View')
    await expect(page.getByTestId('note-row-open-source-project')).toBeVisible()
    await expect(page.getByTestId('note-row-workflow-orchestration')).toBeHidden()

    await openPhoneSidebar(page)
    await longPressTestId(page, 'sidebar-item-view-phone-essay-view')
    await page.getByTestId('workspace-delete-view-action').click()
    await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
    await expect(page.getByTestId('sidebar-item-view-phone-essay-view')).toBeHidden()
  })

  test('applies phone saved-view custom display properties and sort order', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-portrait', 'Phone saved-view display settings run through the phone sidebar drawer.')

    await page.goto('/')
    await addNumericPropertyToPhoneNote(page, 'note-row-workflow-orchestration', 'Priority', '2')
    await addNumericPropertyToPhoneNote(page, 'note-row-open-source-project', 'Priority', '1')

    await openPhoneSidebar(page)
    await page.getByTestId('sidebar-section-create-views').click()
    await page.getByTestId('workspace-view-filter-remove-0').click()
    await page.getByTestId('workspace-view-property-search-input').fill('bel')
    await page.getByTestId('workspace-view-property-option-belongs-to').click()
    await page.getByTestId('workspace-create-view-name-input').fill('Phone Sort View')
    await page.getByTestId('workspace-action-sheet-createView').getByRole('button', { exact: true, name: 'Create' }).click()
    await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()

    await openPhoneSidebar(page)
    await page.getByTestId('sidebar-item-view-phone-sort-view').click()
    await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Phone Sort View')
    await expect(page.getByTestId('note-row-workflow-orchestration').getByText('LLM Workflow')).toBeVisible()

    await openPhoneSidebar(page)
    await page.getByTestId('sidebar-item-inbox').click()
    await openPhoneSidebar(page)
    await longPressTestId(page, 'sidebar-item-view-phone-sort-view')
    await page.getByTestId('workspace-view-sort-custom-field-input').scrollIntoViewIfNeeded()
    await page.getByTestId('workspace-view-sort-custom-field-input').fill('Pri')
    await page.getByTestId('workspace-view-sort-custom-field-suggestion-priority').click()
    await page.getByTestId('workspace-action-sheet-editView').getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()

    await openPhoneSidebar(page)
    await page.getByTestId('sidebar-item-view-phone-sort-view').click()

    await expect(await rowY(page, 'note-row-open-source-project')).toBeLessThan(
      await rowY(page, 'note-row-workflow-orchestration'),
    )
    const workflowRow = page.getByTestId('note-row-workflow-orchestration')
    await expect(workflowRow.getByText('LLM Workflow')).toBeVisible()
    await expect(workflowRow.getByText('Memoria MVP')).toBeVisible()

    await openPhoneSidebar(page)
    await longPressTestId(page, 'sidebar-item-view-phone-sort-view')
    await expect(page.getByTestId('workspace-view-sort-custom-field-input')).toHaveValue('Priority')
    await page.getByTestId('workspace-action-sheet-toolbar').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  })

  test('customizes phone primary note-list display properties', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-portrait', 'Phone primary note-list settings run through the phone sidebar drawer.')

    await page.goto('/')
    await addNumericPropertyToPhoneNote(page, 'note-row-workflow-orchestration', 'Priority', '2')
    await addNumericPropertyToPhoneNote(page, 'note-row-open-source-project', 'Priority', '1')

    await openPhoneSidebar(page)
    await page.getByTestId('sidebar-item-all-notes').click()
    await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('All Notes')
    await openPhoneSidebar(page)
    await longPressTestId(page, 'sidebar-item-all-notes')
    await expect(page.getByTestId('workspace-action-sheet-editPrimaryListProperties')).toBeVisible()
    await page.getByTestId('workspace-primary-property-search-input').fill('Pri')
    await page.getByTestId('workspace-primary-property-option-priority').click()
    await page.getByTestId('workspace-action-sheet-editPrimaryListProperties').getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
    await openPhoneSidebar(page)
    await page.getByTestId('sidebar-item-all-notes').click()
    await expect(page.getByTestId('note-row-workflow-orchestration').getByText('2')).toBeVisible()
    await expect(page.getByTestId('note-row-open-source-project').getByText('1')).toBeVisible()
  })
})

async function addNumericPropertyToPhoneNote(page: Page, rowTestId: string, propertyName: string, propertyValue: string) {
  await page.getByTestId(rowTestId).click()
  await expect(page.getByTestId('phone-editor-screen')).toBeVisible()
  await openPhoneProperties(page)
  await expect(page.getByTestId('phone-properties-screen')).toBeVisible()
  await page.getByTestId('property-action-add-property').click()
  await page.getByTestId('workspace-property-name-input').fill(propertyName)
  await page.getByTestId('workspace-property-kind-number').click()
  await page.getByTestId('workspace-property-value-input').fill(propertyValue)
  await page.getByTestId('workspace-action-sheet-addProperty').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId(`property-row-${propertyName.toLowerCase()}`)).toContainText(propertyValue)
  await phoneBack(page)
  await phoneBack(page)
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Inbox')
  await expect(page.getByTestId(rowTestId)).toBeInViewport({ ratio: 1 })
}

async function rowY(page: Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox()
  if (!box) throw new Error(`Cannot measure missing row: ${testId}`)
  return box.y
}
