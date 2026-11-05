import { expect, test, type Page } from '@playwright/test'
import { workspaceScenarioForId } from '../src/fixtures/workspaceFixtures'
import type { MobileVaultConfig } from '../src/workspace/mobileWorkspaceModel'
import type { MobileWorkspaceWrite } from '../src/workspace/mobileWorkspaceEditing'
import {
  HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY,
  HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY,
  HOST_WORKSPACE_SNAPSHOT_STORAGE_KEY,
  HOST_WORKSPACE_VAULT_CONFIG_GLOBAL_KEY,
  HOST_WORKSPACE_WRITES_GLOBAL_KEY,
} from '../src/workspace/readOnlyWorkspaceRepository'

test.describe('mobile host config persistence', () => {
  test('persists host vault-scoped note-list and default-width config writes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Host config checks use the full-width tablet layout.')

    await installFixtureHostWorkspace(page)
    await page.goto('/?source=host-vault')

    await setWideDefaultNoteWidth(page)
    await expect.poll(() => latestHostVaultConfig(page)).toMatchObject({
      defaultNoteWidth: 'wide',
    })

    await customizeAllNotesHostConfig(page)
    await expect.poll(() => latestHostVaultConfig(page)).toMatchObject({
      allNotes: {
        fileVisibility: { images: true, pdfs: true, unsupported: false },
        noteListProperties: ['Priority'],
      },
      defaultNoteWidth: 'wide',
    })
    await expect.poll(() => latestHostConfigWrite(page)).toMatchObject({
      config: expect.objectContaining({
        allNotes: expect.objectContaining({
          noteListProperties: ['Priority'],
        }),
        defaultNoteWidth: 'wide',
      }),
      kind: 'saveVaultConfig',
    })
  })
})

async function setWideDefaultNoteWidth(page: Page) {
  await page.getByTestId('sidebar-command-palette-action').click()
  await expect(page.getByTestId('mobile-command-palette')).toBeVisible()
  await page.getByTestId('mobile-command-palette-input').fill('wide default')
  await page.getByTestId('mobile-command-palette-command-set-default-note-width-wide').click()
  await expect(page.getByTestId('mobile-command-palette')).toBeHidden()
}

async function customizeAllNotesHostConfig(page: Page) {
  await page.getByTestId('sidebar-item-all-notes').click()
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('All Notes')
  await longPressTestId(page, 'sidebar-item-all-notes')
  await expect(page.getByTestId('workspace-action-sheet-editPrimaryListProperties')).toBeVisible()
  await page.getByTestId('workspace-all-notes-show-pdfs').click()
  await page.getByTestId('workspace-all-notes-show-images').click()
  await page.getByTestId('workspace-primary-property-search-input').fill('Pri')
  await page.getByTestId('workspace-primary-property-option-priority').click()
  await page.getByTestId('workspace-action-sheet-editPrimaryListProperties').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
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

async function latestHostVaultConfig(page: Page): Promise<MobileVaultConfig | null> {
  return page.evaluate((configKey) => {
    return ((window as unknown as Record<string, unknown>)[configKey] ?? null) as MobileVaultConfig | null
  }, HOST_WORKSPACE_VAULT_CONFIG_GLOBAL_KEY)
}

async function latestHostConfigWrite(
  page: Page,
): Promise<Extract<MobileWorkspaceWrite, { kind: 'saveVaultConfig' }> | null> {
  return page.evaluate((writeKey) => {
    const writes = (window as unknown as Record<string, unknown>)[writeKey]
    if (!Array.isArray(writes)) return null
    return writes.filter((write) => (
      Boolean(write) && typeof write === 'object' && (write as { kind?: unknown }).kind === 'saveVaultConfig'
    )).at(-1) ?? null
  }, HOST_WORKSPACE_WRITES_GLOBAL_KEY) as Promise<Extract<MobileWorkspaceWrite, { kind: 'saveVaultConfig' }> | null>
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
