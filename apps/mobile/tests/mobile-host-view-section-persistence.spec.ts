import { expect, test, type Page } from '@playwright/test'
import { workspaceScenarioForId } from '../src/fixtures/workspaceFixtures'
import type { MobileWorkspaceWrite } from '../src/workspace/mobileWorkspaceEditing'
import {
  HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY,
  HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY,
  HOST_WORKSPACE_SNAPSHOT_STORAGE_KEY,
  HOST_WORKSPACE_WRITES_GLOBAL_KEY,
} from '../src/workspace/readOnlyWorkspaceRepository'

test.describe('mobile host view and section persistence', () => {
  test('persists host saved-view and Type-section edits as desktop-compatible writes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Host persistence checks use the full-width tablet layout.')

    await installFixtureHostWorkspace(page)
    await page.goto('/?source=host-vault')

    await createEditAndDeleteHostSavedView(page)
    await expect.poll(() => hostWorkspaceWrites(page)).toContainEqual(expect.objectContaining({
      content: expect.stringContaining('name: "Host View Persistence"'),
      kind: 'saveView',
      path: 'views/host-view-persistence.yml',
    }))
    await expect.poll(() => hostWorkspaceWrites(page)).toContainEqual(expect.objectContaining({
      content: expect.stringContaining('name: "Host View Updated"'),
      kind: 'saveView',
      path: 'views/host-view-persistence.yml',
    }))
    await expect.poll(() => hostWorkspaceWrites(page)).toContainEqual({
      kind: 'deleteView',
      path: 'views/host-view-persistence.yml',
    })

    await editHostProcedureTypeSection(page)
    await expect.poll(() => latestHostWriteForPath(page, 'procedure.md')).toMatchObject({
      kind: 'saveNote',
      path: 'procedure.md',
    })
    await expect.poll(() => latestHostWriteContentForPath(page, 'procedure.md')).toEqual(
      expect.stringContaining('_sidebar_label: Host Runbooks'),
    )
    await expect.poll(() => latestHostWriteContentForPath(page, 'procedure.md')).toEqual(
      expect.stringContaining('template: |'),
    )
    await expect.poll(() => latestHostWriteContentForPath(page, 'procedure.md')).toEqual(
      expect.stringContaining('Priority: High'),
    )
    await expect.poll(() => latestHostWriteContentForPath(page, 'procedure.md')).toEqual(
      expect.stringContaining('belongs_to:'),
    )
  })
})

async function createEditAndDeleteHostSavedView(page: Page) {
  await page.getByTestId('sidebar-section-create-views').click()
  await page.getByTestId('workspace-view-filter-remove-0').click()
  await page.getByTestId('workspace-create-view-name-input').fill('Host View Persistence')
  await page.getByTestId('workspace-action-sheet-createView').getByRole('button', { exact: true, name: 'Create' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Host View Persistence' })).toBeVisible()

  await longPressTestId(page, 'sidebar-item-view-host-view-persistence')
  await page.getByTestId('workspace-edit-view-name-input').fill('Host View Updated')
  await page.getByTestId('workspace-view-icon-star').click()
  await page.getByTestId('workspace-view-tone-green').click()
  await page.getByTestId('workspace-action-sheet-editView').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Host View Updated' })).toBeVisible()

  await longPressTestId(page, 'sidebar-item-view-host-view-persistence')
  await page.getByTestId('workspace-delete-view-action').click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Host View Updated' })).toBeHidden()
}

async function editHostProcedureTypeSection(page: Page) {
  await longPressTestId(page, 'sidebar-item-procedures')
  const sheet = page.getByTestId('workspace-action-sheet-editTypeSection')
  await expect(sheet).toBeVisible()
  await page.getByTestId('workspace-type-section-label-input').fill('Host Runbooks')
  await page.getByTestId('workspace-type-icon-folder').click()
  await page.getByTestId('workspace-type-tone-green').click()
  await page.getByTestId('workspace-type-sort-custom-field-input').fill('Priority')
  await page.getByTestId('workspace-type-sort-custom-desc').click()
  await page.getByTestId('workspace-type-template-input').fill('## Host Template\n\nHost Type-section persistence body.')
  await page.getByTestId('workspace-type-schema-property-name-input').scrollIntoViewIfNeeded()
  await page.getByTestId('workspace-type-schema-property-name-input').fill('Priority')
  await page.getByTestId('workspace-type-schema-property-value-input').fill('High')
  await sheet.getByRole('button', { name: 'Add property' }).click()
  await page.getByTestId('workspace-type-schema-relationship-name-suggestion-belongs-to').click()
  await page.getByTestId('workspace-type-schema-relationship-target-input').fill('Workflow Orchestration Essay')
  await sheet.getByRole('button', { name: 'Add relationship' }).click()
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId('sidebar-item-procedures')).toContainText('Host Runbooks')
}

async function installFixtureHostWorkspace(page: Page) {
  const snapshot = workspaceScenarioForId('default')

  await page.addInitScript(
    ({ contentKey, globalKey, key, snapshot, value, writeKey }) => {
      Reflect.set(window, globalKey, snapshot)
      Reflect.set(window, contentKey, {})
      Reflect.set(window, writeKey, [])
      window.localStorage.setItem(key, value)
    },
    {
      contentKey: HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY,
      globalKey: HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY,
      key: HOST_WORKSPACE_SNAPSHOT_STORAGE_KEY,
      snapshot,
      value: JSON.stringify(snapshot),
      writeKey: HOST_WORKSPACE_WRITES_GLOBAL_KEY,
    },
  )
}

async function hostWorkspaceWrites(page: Page): Promise<MobileWorkspaceWrite[]> {
  return page.evaluate((writeKey) => {
    const writes = (window as unknown as Record<string, unknown>)[writeKey]
    return Array.isArray(writes) ? writes : []
  }, HOST_WORKSPACE_WRITES_GLOBAL_KEY) as Promise<MobileWorkspaceWrite[]>
}

async function latestHostWriteForPath(page: Page, path: string): Promise<MobileWorkspaceWrite | null> {
  return hostWorkspaceWrites(page).then((writes) => (
    writes.filter((write) => 'path' in write && write.path === path).at(-1) ?? null
  ))
}

async function latestHostWriteContentForPath(page: Page, path: string): Promise<string> {
  const write = await latestHostWriteForPath(page, path)
  return write && 'content' in write ? write.content : ''
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
