import { openPhoneProperties, openPhoneSidebar, phoneBack } from './mobile-panel-navigation'
import { expect } from '@playwright/test'
import type { Page as PageLike } from '@playwright/test'
import { ensureMarkdownInput } from './mobile-workspace-property-flows'

export async function navigatePhoneSidebarSection(page: PageLike) {
  await expect(page.getByTestId('phone-note-list-screen')).toBeVisible()
  await expect(page.getByTestId('phone-note-list-screen').getByTestId('phone-command-palette-action')).toHaveCount(0)
  await openPhoneSidebar(page)
  await expect(page.getByTestId('phone-sidebar-screen')).toBeVisible()
  await expect(page.getByTestId('phone-sidebar-screen').getByTestId('sidebar-command-palette-action')).toBeVisible()
  await swipeHorizontally(page, { x: 220, y: 300 }, { x: 40, y: 300 })
  await expect(page.getByTestId('phone-note-list-screen')).toBeVisible()
  await openPhoneSidebar(page)
  await expect(page.getByTestId('phone-sidebar-screen')).toBeVisible()
  await page.getByRole('button', { name: 'All Notes' }).click()
  await expect(page.getByTestId('phone-note-list-screen')).toBeVisible()
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('All Notes')
  await openPhoneFavoriteNeighborhood(page)
}

export async function openPhoneEditorAndProperties(page: PageLike) {
  await page.getByTestId('note-row-workflow-orchestration').click()
  await expect(page.getByTestId('phone-editor-screen')).toBeVisible()
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText('Workflow Orchestration Essay.md')
  await openPhoneProperties(page)
  await expect(page.getByTestId('phone-properties-screen')).toBeVisible()
  await expect(page.getByTestId('properties-panel')).toBeVisible()
}

async function openPhoneFavoriteNeighborhood(page: PageLike) {
  await page.getByTestId('note-row-open-source-project').click()
  await expect(page.getByTestId('phone-editor-screen')).toBeVisible()
  await page.getByTestId('editor-favorite-action').click()
  await expect(page.getByTestId('editor-favorite-action')).toHaveAccessibleName('Remove from Favorites')
  await phoneBack(page)
  await expect(page.getByTestId('phone-note-list-screen')).toBeVisible()

  await openPhoneSidebar(page)
  await expect(page.getByTestId('sidebar-item-favorite-open-source-project')).toBeVisible()
  await page.getByTestId('sidebar-item-favorite-open-source-project').click()
  await expect(page.getByTestId('phone-note-list-screen')).toBeVisible()
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('How I Run an Open Source Project')
  await expect(page.getByTestId('note-row-open-source-project')).toBeVisible()

  await openPhoneSidebar(page)
  await page.getByRole('button', { name: 'All Notes' }).click()
  await expect(page.getByTestId('phone-note-list-screen')).toBeVisible()
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('All Notes')
}

export async function editPhoneProperty(page: PageLike) {
  await expect(page.getByTestId('phone-properties-screen')).toBeInViewport({ ratio: 1 })
  await page.getByTestId('property-action-add-property').scrollIntoViewIfNeeded()
  await page.getByTestId('property-action-add-property').click()
  await expect(page.getByTestId('workspace-action-sheet-addProperty')).toBeVisible()
  await page.getByTestId('workspace-property-name-input').fill('Phone QA')
  await page.getByTestId('workspace-property-value-input').fill('Ready')
  await page.getByTestId('workspace-action-sheet-addProperty').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId('property-row-phone-qa')).toContainText('Ready')
}

export async function editPhoneMarkdownWithWikilink(page: PageLike) {
  await page.getByTestId('phone-top-bar').getByTestId('phone-back-action').click()
  await expect(page.getByTestId('phone-editor-screen')).toBeVisible()
  const input = await ensureMarkdownInput(page)
  await input.fill('# Workflow Orchestration Essay\n\nPhone editing links [[Proj')
  await expect(page.getByTestId('editor-wikilink-suggestions')).toBeVisible()
  await page.getByTestId('editor-wikilink-suggestion-open-source-project').click()
  await expect(input).toHaveValue('# Workflow Orchestration Essay\n\nPhone editing links [[Memoria/Mobile UI/How I Run an Open Source Project]]')
}

export async function returnPhoneEditorToList(page: PageLike) {
  await phoneBack(page)
  await expect(page.getByTestId('phone-note-list-screen')).toBeVisible()
  await expect(page.getByTestId('note-row-workflow-orchestration')).toBeVisible()
}

export async function navigatePhoneSwipeGestures(page: PageLike) {
  await swipeHorizontally(page, { x: 12, y: 300 }, { x: 180, y: 300 })
  await expect(page.getByTestId('phone-sidebar-screen')).toBeVisible()
  await swipeHorizontally(page, { x: 220, y: 300 }, { x: 40, y: 300 })
  await expect(page.getByTestId('phone-note-list-screen')).toBeVisible()

  await page.getByTestId('note-row-workflow-orchestration').click()
  await expect(page.getByTestId('phone-editor-screen')).toBeVisible()
  await swipeHorizontally(page, { x: 378, y: 300 }, { x: 80, y: 300 })
  await expect(page.getByTestId('phone-properties-screen')).toBeVisible()
  await swipeHorizontally(page, { x: 12, y: 300 }, { x: 360, y: 300 })
  await expect(page.getByTestId('phone-editor-screen')).toBeVisible()
  await swipeHorizontally(page, { x: 12, y: 300 }, { x: 360, y: 300 })
  await expect(page.getByTestId('phone-note-list-screen')).toBeVisible()
}

export async function createSavedViewFromSidebar(
  page: PageLike,
  options: { displayPropertyQuery?: string; displayPropertyTestId?: string; returnToInbox?: boolean } = {},
) {
  await page.getByTestId('sidebar-section-create-views').click()
  await expect(page.getByTestId('workspace-create-view-name-input')).toBeVisible()
  await expect(page.getByTestId('workspace-create-view-name-input')).toHaveValue('')
  await expect(page.getByTestId('workspace-view-filter-value-input-0')).toHaveValue('')
  await page.getByTestId('workspace-view-filter-remove-0').click()
  if (options.displayPropertyQuery && options.displayPropertyTestId) {
    await page.getByTestId('workspace-view-property-search-input').fill(options.displayPropertyQuery)
    await page.getByTestId(`workspace-view-property-option-${options.displayPropertyTestId}`).click()
  }
  await page.getByTestId('workspace-create-view-name-input').fill('Mobile Inbox View')
  await page.getByTestId('workspace-action-sheet-createView').getByRole('button', { exact: true, name: 'Create' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Mobile Inbox View' })).toBeVisible()
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Mobile Inbox View')
  if (options.displayPropertyTestId) {
    await expect(page.getByTestId('note-row-workflow-orchestration').getByText('LLM Workflow')).toBeVisible()
  }
  if (options.returnToInbox) {
    await page.getByTestId('sidebar-item-inbox').click()
    await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Inbox')
  }
}

export async function editAndDeleteSavedView(page: PageLike) {
  await longPress(page, 'sidebar-item-view-active-procedures')
  await expect(page.getByTestId('workspace-edit-view-name-input')).toBeVisible()
  await expect(page.getByTestId('workspace-edit-view-name-input')).toHaveValue('Active Procedures')
  await page.getByTestId('workspace-edit-view-name-input').fill('Active Workflows')
  await expect(page.getByTestId('workspace-view-filter-value-input-0')).toHaveValue('Procedure')
  await page.getByTestId('workspace-view-filter-value-input-0').fill('Essay')
  await page.getByTestId('workspace-view-filter-remove-1').click()
  await page.getByTestId('workspace-action-sheet-editView').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Active Workflows' })).toBeVisible()
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Active Workflows')
  await expect(page.getByText('Workflow Orchestration Essay').first()).toBeVisible()
  await expect(page.getByText('How I Run an Open Source Project').first()).toBeHidden()

  await longPress(page, 'sidebar-item-view-active-procedures')
  await page.getByTestId('workspace-delete-view-action').click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Active Workflows' })).toBeHidden()
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Inbox')
}

export async function moveCreatedSavedView(page: PageLike) {
  const activeView = page.getByTestId('sidebar-item-view-active-procedures')
  const mobileView = page.getByTestId('sidebar-item-view-mobile-inbox-view')
  await expect(await rowY(mobileView)).toBeGreaterThan(await rowY(activeView))

  await longPress(page, 'sidebar-item-view-mobile-inbox-view')
  await expect(page.getByRole('button', { name: 'Move view up' })).toBeVisible()
  await page.getByRole('button', { name: 'Move view up' }).click()
  await expect(await rowY(mobileView)).toBeLessThan(await rowY(activeView))

  await page.getByRole('button', { name: 'Move view down' }).click()
  await expect(await rowY(mobileView)).toBeGreaterThan(await rowY(activeView))
  await page.getByTestId('workspace-action-sheet-toolbar').getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
}

export async function customizeCreatedSavedViewColumns(page: PageLike) {
  await longPress(page, 'sidebar-item-view-mobile-inbox-view')
  await page.getByTestId('workspace-view-icon-star').click()
  await page.getByTestId('workspace-view-tone-green').click()
  await expect(page.getByTestId('workspace-view-selected-icon')).toContainText('star')
  await expect(page.getByTestId('workspace-view-selected-color')).toContainText('green')
  await page.getByTestId('workspace-view-property-picker').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('workspace-view-property-picker')).toBeVisible()
  await page.getByTestId('workspace-view-sort-custom-field-input').fill('Pri')
  await page.getByTestId('workspace-view-sort-custom-field-suggestion-priority').click()
  await page.getByTestId('workspace-view-property-search-input').fill('bel')
  await page.getByTestId('workspace-view-property-option-belongs-to').click()
  await page.getByTestId('workspace-action-sheet-editView').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()

  await expect(await rowY(page.getByTestId('note-row-open-source-project'))).toBeLessThan(
    await rowY(page.getByTestId('note-row-workflow-orchestration')),
  )
  const workflowRow = page.getByTestId('note-row-workflow-orchestration')
  await expect(workflowRow.getByText('LLM Workflow')).toBeVisible()
  await expect(workflowRow.getByText('Memoria MVP')).toBeVisible()

  await longPress(page, 'sidebar-item-view-mobile-inbox-view')
  await expect(page.getByTestId('workspace-view-selected-icon')).toContainText('star')
  await expect(page.getByTestId('workspace-view-selected-color')).toContainText('green')
  await page.getByTestId('workspace-action-sheet-toolbar').getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
}

export async function customizeAllNotesColumns(page: PageLike) {
  await page.getByTestId('sidebar-item-all-notes').click()
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('All Notes')
  await longPress(page, 'sidebar-item-all-notes')
  await expect(page.getByTestId('workspace-action-sheet-editPrimaryListProperties')).toBeVisible()
  await expect(page.getByTestId('workspace-all-notes-file-visibility')).toBeVisible()
  await expect(page.getByTestId('workspace-all-notes-show-pdfs')).not.toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('workspace-all-notes-show-pdfs').click()
  await page.getByTestId('workspace-all-notes-show-images').click()
  await page.getByTestId('workspace-primary-property-search-input').fill('Pri')
  await page.getByTestId('workspace-primary-property-option-priority').click()
  await page.getByTestId('workspace-action-sheet-editPrimaryListProperties').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId('note-row-workflow-orchestration').getByText('2')).toBeVisible()
  await expect(page.getByTestId('note-row-open-source-project').getByText('1')).toBeVisible()
  await longPress(page, 'sidebar-item-all-notes')
  await expect(page.getByTestId('workspace-all-notes-show-pdfs')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('workspace-all-notes-show-images')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('workspace-all-notes-show-unsupported')).not.toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('workspace-action-sheet-toolbar').getByRole('button', { name: 'Cancel' }).click()
}

export async function addPrioritySortFixtures(page: PageLike) {
  await addNumericPropertyToNote(page, 'note-row-workflow-orchestration', 'Priority', '2')
  await addNumericPropertyToNote(page, 'note-row-open-source-project', 'Priority', '1')
}

async function addNumericPropertyToNote(
  page: PageLike,
  rowTestId: string,
  propertyName: string,
  propertyValue: string,
) {
  await page.getByTestId(rowTestId).click()
  await page.getByTestId('property-action-add-property').click()
  await page.getByTestId('workspace-property-name-input').fill(propertyName)
  await page.getByTestId('workspace-property-kind-number').click()
  await page.getByTestId('workspace-property-value-input').fill(propertyValue)
  await page.getByTestId('workspace-action-sheet-addProperty').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId(`property-row-${propertyName.toLowerCase()}`)).toContainText(propertyValue)
}

async function longPress(page: PageLike, testId: string) {
  await longPressLocator(page, page.getByTestId(testId), testId)
}

export async function bulkSelectDefaultNotes(page: PageLike) {
  await longPress(page, 'note-row-workflow-orchestration')
  await page.getByTestId('note-row-open-source-project').click()
  await expect(page.getByTestId('note-list-bulk-action-bar')).toBeVisible()
}

async function swipeHorizontally(
  page: PageLike,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const client = await page.context().newCDPSession(page)
  await client.send('Input.dispatchTouchEvent', {
    touchPoints: [start],
    type: 'touchStart',
  })
  for (const progress of [0.25, 0.5, 0.75, 1]) {
    await client.send('Input.dispatchTouchEvent', {
      touchPoints: [{ x: start.x + (end.x - start.x) * progress, y: start.y + (end.y - start.y) * progress }],
      type: 'touchMove',
    })
    await page.waitForTimeout(30)
  }
  await client.send('Input.dispatchTouchEvent', {
    touchPoints: [],
    type: 'touchEnd',
  })
  await client.detach()
}

export async function longPressRoleButton(page: PageLike, name: string) {
  await longPressLocator(page, page.getByRole('button', { name }).first(), name)
}

async function longPressLocator(
  page: PageLike,
  target: ReturnType<PageLike['getByTestId']>,
  label: string,
) {
  const box = await target.boundingBox()
  if (!box) throw new Error(`Cannot long-press missing target: ${label}`)

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(700)
  await page.mouse.up()
}

async function rowY(locator: ReturnType<PageLike['getByTestId']>) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Cannot measure missing sidebar row.')
  return box.y
}
