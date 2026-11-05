import { expect, test, type Page } from '@playwright/test'
import { workspaceScenarioForId } from '../src/fixtures/workspaceFixtures'
import { longPressMouseTestId } from './mobile-phone-test-gestures'
import type { MobileWorkspaceWrite } from '../src/workspace/mobileWorkspaceEditing'

const targetId = 'open-source-project'
const targetPath = 'Memoria/Mobile UI/How I Run an Open Source Project.md'
const targetContent = '---\ntitle: How I Run an Open Source Project\ncustom: preserve this\n---\n\nOriginal full body for Undo.\n'

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== 'tablet-landscape')
  const snapshot = workspaceScenarioForId('default')
  const notes = snapshot.notes.map((note) => ({ ...note, rawContent: undefined }))
  await page.addInitScript(({ snapshot, notes, targetPath, targetContent }) => {
    Reflect.set(window, '__MEMORIA_MOBILE_WORKSPACE_SNAPSHOT__', { ...snapshot, notes, allNotes: notes })
    Reflect.set(window, '__MEMORIA_MOBILE_WORKSPACE_NOTE_CONTENTS__', {
      'Memoria/Mobile UI/Workflow Orchestration Essay.md': '# Workflow Orchestration Essay\n\nSelected note.',
      [targetPath]: targetContent,
    })
    Reflect.set(window, '__MEMORIA_MOBILE_WORKSPACE_WRITES__', [])
  }, { snapshot, notes, targetPath, targetContent })
  await page.goto('/?source=host-vault')
  await expect(page.getByTestId(`note-row-${targetId}`)).toBeVisible()
})

test('@smoke loads an unselected note before bulk archive', async ({ page }) => {
  await longPressMouseTestId(page, `note-row-${targetId}`)
  await page.getByTestId('note-list-bulk-archive').click()
  await expect.poll(() => writes(page)).toContainEqual(expect.objectContaining({
    kind: 'saveNote', path: targetPath, content: expect.stringContaining('Original full body for Undo.'),
  }))
  await expect(page.getByTestId(`note-row-${targetId}`)).toBeHidden()
})

test('@smoke delete and Undo restore the entire previously unloaded file', async ({ page }) => {
  await longPressMouseTestId(page, `note-row-${targetId}`)
  await page.getByTestId('note-list-bulk-delete').click()
  await expect.poll(() => writes(page)).toContainEqual({ kind: 'deleteNote', path: targetPath })
  await page.getByTestId('editor-more-action').click()
  await page.getByTestId('workspace-action-group-edit').click()
  await page.getByTestId('workspace-action-undo-edit').click()
  await expect.poll(() => writes(page)).toContainEqual({ kind: 'createNote', path: targetPath, content: targetContent })
  await expect(page.getByTestId(`note-row-${targetId}`)).toBeVisible()
})

test('@smoke a failed bulk read is visible and retry uses recovered file contents', async ({ page }) => {
  await page.evaluate((path) => {
    const contents = Reflect.get(window, '__MEMORIA_MOBILE_WORKSPACE_NOTE_CONTENTS__')
    Reflect.deleteProperty(contents, path)
  }, targetPath)
  await longPressMouseTestId(page, `note-row-${targetId}`)
  await page.getByTestId('note-list-bulk-archive').click()
  await expect(page.getByTestId('workspace-edit-retry')).toBeVisible()
  expect(await writes(page)).toEqual([])
  await expect(page.getByTestId(`note-row-${targetId}`)).toBeVisible()
  await page.evaluate(({ path, content }) => {
    Reflect.set(Reflect.get(window, '__MEMORIA_MOBILE_WORKSPACE_NOTE_CONTENTS__'), path, content)
  }, { path: targetPath, content: targetContent })
  await page.getByTestId('workspace-edit-retry').click()
  await expect.poll(() => writes(page)).toContainEqual(expect.objectContaining({ kind: 'saveNote', path: targetPath }))
  await expect(page.getByTestId('workspace-edit-retry')).toBeHidden()
})

async function writes(page: Page): Promise<MobileWorkspaceWrite[]> {
  return page.evaluate(() => Reflect.get(window, '__MEMORIA_MOBILE_WORKSPACE_WRITES__'))
}
