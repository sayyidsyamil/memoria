import { expect, test } from '@playwright/test'
import { workspaceScenarioForId } from '../src/fixtures/workspaceFixtures'
import { HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY, HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY } from '../src/workspace/readOnlyWorkspaceRepository'

test('opens and reloads a host vault without native snapshot-cache services @smoke', async ({ page }) => {
  const snapshot = workspaceScenarioForId('default')
  const content = '---\ntype: Essay\ncustom: preserved\n---\n# Host startup source\n\nFresh host source.\n'
  await page.addInitScript(({ snapshotKey, contentKey, snapshot, content }) => {
    Reflect.set(window, snapshotKey, snapshot)
    Reflect.set(window, contentKey, { 'Memoria/Mobile UI/Workflow Orchestration Essay.md': content })
  }, { snapshotKey: HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY, contentKey: HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY, snapshot, content })
  await page.goto('/?source=host-vault&phoneState=list&editorMode=source')
  await page.getByTestId('note-row-workflow-orchestration').click()
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(content)
  await page.reload()
  await page.getByTestId('note-row-workflow-orchestration').click()
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(content)
})
