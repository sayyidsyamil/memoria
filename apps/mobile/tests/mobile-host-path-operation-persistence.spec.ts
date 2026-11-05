import { expect, test, type Page } from '@playwright/test'
import { workspaceScenarioForId } from '../src/fixtures/workspaceFixtures'
import type { MobileWorkspaceWrite } from '../src/workspace/mobileWorkspaceEditing'
import {
  HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY,
  HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY,
  HOST_WORKSPACE_SNAPSHOT_STORAGE_KEY,
  HOST_WORKSPACE_WRITES_GLOBAL_KEY,
} from '../src/workspace/readOnlyWorkspaceRepository'
import { longPressRoleButton } from './mobile-phone-test-gestures'
import { createTitledNoteFromQuickOpen } from './mobile-note-create-actions'

test.describe('mobile host path operation persistence', () => {
  test('persists host folder and note path operations as desktop-compatible writes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Host path persistence checks use the full-width tablet layout.')

    await installFixtureHostWorkspace(page)
    await page.goto('/?source=host-vault')

    await createHostFolder(page)
    await expect.poll(() => hostWorkspaceWrites(page)).toContainEqual({
      kind: 'createFolder',
      path: 'Host Ops Folder',
    })

    await renameHostFolder(page)
    await expect.poll(() => hostWorkspaceWrites(page)).toContainEqual({
      kind: 'renameFolder',
      path: 'Host Ops Folder',
      toPath: 'Host Ops Renamed',
    })

    await createHostNoteInFolder(page)
    await expect.poll(() => hostWorkspaceWrites(page)).toContainEqual(expect.objectContaining({
      content: expect.stringContaining('title: Host Path Draft'),
      kind: 'createNote',
      path: 'Host Ops Renamed/host-path-draft.md',
    }))

    await moveHostNoteToMemoriaFolder(page)
    await expect.poll(() => hostWorkspaceWrites(page)).toContainEqual({
      kind: 'moveNote',
      path: 'Host Ops Renamed/host-path-draft.md',
      toPath: 'Memoria/Mobile UI/host-path-draft.md',
    })

    await deleteMovedHostNote(page)
    await expect.poll(() => hostWorkspaceWrites(page)).toContainEqual({
      kind: 'deleteNote',
      path: 'Memoria/Mobile UI/host-path-draft.md',
    })

    await deleteHostFolder(page)
    await expect.poll(() => hostWorkspaceWrites(page)).toContainEqual({
      kind: 'deleteFolder',
      path: 'Host Ops Renamed',
    })
  })
})

async function createHostFolder(page: Page) {
  await page.getByTestId('sidebar-section-create-folders').click()
  await page.getByTestId('workspace-create-folder-name-input').fill('Host Ops Folder')
  await page.getByTestId('workspace-action-sheet-createFolder').getByRole('button', { exact: true, name: 'Create' }).click()
  await expect(page.getByRole('button', { name: 'Host Ops Folder' })).toBeVisible()
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Host Ops Folder')
}

async function renameHostFolder(page: Page) {
  await longPressRoleButton(page, 'Host Ops Folder')
  await expect(page.getByTestId('workspace-rename-folder-input')).toHaveValue('Host Ops Folder')
  await page.getByTestId('workspace-rename-folder-input').fill('Host Ops Renamed')
  await page.getByTestId('workspace-action-sheet-editFolder').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('button', { name: 'Host Ops Renamed' })).toBeVisible()
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Host Ops Renamed')
}

async function createHostNoteInFolder(page: Page) {
  await createTitledNoteFromQuickOpen(page, 'Host Path Draft', 'note-row-Host Ops Renamed/host-path-draft.md')
}

async function moveHostNoteToMemoriaFolder(page: Page) {
  await page.getByTestId('editor-more-action').click()
  await page.getByTestId('workspace-action-group-file').click()
  await page.getByTestId('workspace-action-move-note-folder').click()
  await page.getByTestId('workspace-move-folder-input').fill('Memoria')
  await page.getByTestId('workspace-move-folder-suggestion-memoria-mobile-ui').click()
  await page.getByTestId('workspace-action-sheet-moveNoteToFolder').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
}

async function deleteMovedHostNote(page: Page) {
  await page.getByTestId('editor-more-action').click()
  await page.getByTestId('workspace-action-delete-note').click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
}

async function deleteHostFolder(page: Page) {
  await longPressRoleButton(page, 'Host Ops Renamed')
  await page.getByTestId('workspace-action-delete-folder').click()
  await expect(page.getByRole('button', { name: 'Host Ops Renamed' })).toBeHidden()
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
