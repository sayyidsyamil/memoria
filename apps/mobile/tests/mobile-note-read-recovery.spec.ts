import { expect, test, type Page } from '@playwright/test'
import { workspaceScenarioForId } from '../src/fixtures/workspaceFixtures'
import {
  HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY,
  HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY,
  HOST_WORKSPACE_WRITES_GLOBAL_KEY,
} from '../src/workspace/readOnlyWorkspaceRepository'

const path = 'recovery.md'
const content = '---\nstatus: Draft\ncustom: preserved\n---\n# Recovered note\n\nOriginal body.\n'

test('@smoke retries a failed note read without offering an empty editor or writing a substitute', async ({ page }, info) => {
  test.skip(info.project.name !== 'tablet-landscape', 'Shared editor recovery is checked in the tablet workspace.')
  await installUnreadableNote(page)
  await page.goto('/?source=host-vault&editorMode=source')
  await expect(page.getByTestId('note-read-error')).toBeVisible()
  await expect(page.getByTestId('editor-markdown-form')).toBeHidden()
  await page.getByTestId('editor-favorite-action').click()
  await expect(page.getByTestId('note-read-error')).toBeVisible()
  expect(await writes(page)).toEqual([])

  await page.getByTestId('note-read-retry').click()
  await expect(page.getByTestId('note-read-error')).toBeVisible()
  await page.evaluate(({ key, path, content }) => Reflect.set(window, key, { [path]: content }), {
    key: HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY, path, content,
  })
  await page.getByTestId('note-read-retry').click()
  await expect(page.getByTestId('note-read-error')).toBeHidden()
  const editor = page.getByTestId('editor-markdown-input')
  await expect(editor).toHaveValue(content)
  expect(await writes(page)).toEqual([])
  await editor.fill(`${content}\nRecovered edit.\n`)
  await expect.poll(() => writes(page)).toContainEqual(expect.objectContaining({
    kind: 'saveNote', path, content: `${content}\nRecovered edit.\n`,
  }))
})

async function installUnreadableNote(page: Page) {
  const base = workspaceScenarioForId('default')
  const note = { ...base.notes[0], path, rawContent: undefined }
  const snapshot = { ...base, notes: [note], allNotes: [note] }
  await page.addInitScript(({ snapshot, snapshotKey, contentsKey, writesKey }) => {
    Reflect.set(window, snapshotKey, snapshot)
    Reflect.set(window, contentsKey, {})
    Reflect.set(window, writesKey, [])
  }, { snapshot, snapshotKey: HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY, contentsKey: HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY, writesKey: HOST_WORKSPACE_WRITES_GLOBAL_KEY })
}

function writes(page: Page) {
  return page.evaluate((key) => Reflect.get(window, key), HOST_WORKSPACE_WRITES_GLOBAL_KEY)
}
