import { expect, test, type Page } from '@playwright/test'
import { workspaceScenarioForId } from '../src/fixtures/workspaceFixtures'
import {
  HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY,
  HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY,
  HOST_WORKSPACE_SNAPSHOT_STORAGE_KEY,
  HOST_WORKSPACE_WRITES_GLOBAL_KEY,
} from '../src/workspace/readOnlyWorkspaceRepository'
import type { MobileWorkspaceWrite } from '../src/workspace/mobileWorkspaceEditing'

const selectedNotePath = 'Memoria/Mobile UI/Workflow Orchestration Essay.md'

test.describe('mobile host persistence actions', () => {
  test('persists hydrated host property and relationship edits as save-note writes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Host persistence checks use the full-width tablet layout.')

    await installFixtureHostWorkspace(page, hydratedWorkflowMarkdown())
    await page.goto('/?source=host-vault')

    await expect(page.getByTestId('property-row-status')).toContainText('Active')
    await addReviewScoreProperty(page)
    await expect.poll(() => hostWorkspaceWrites(page)).toContainEqual(expect.objectContaining({
      content: expect.stringContaining('ReviewScore: 8'),
      kind: 'saveNote',
      path: selectedNotePath,
    }))

    await addRelatedOpenSourceProject(page)
    await expect.poll(() => hostWorkspaceWrites(page)).toContainEqual(expect.objectContaining({
      content: expect.stringContaining('related_to:'),
      kind: 'saveNote',
      path: selectedNotePath,
    }))
    await expect.poll(() => latestHostWorkspaceWriteContent(page)).toContain(
      '[[Memoria/Mobile UI/How I Run an Open Source Project]]',
    )
  })
})

async function addReviewScoreProperty(page: Page) {
  await page.getByTestId('property-action-add-property').click()
  await page.getByTestId('workspace-property-name-input').fill('ReviewScore')
  await page.getByTestId('workspace-property-kind-number').click()
  await page.getByTestId('workspace-property-value-input').fill('8')
  await page.getByTestId('workspace-action-sheet-addProperty').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId('property-row-reviewscore')).toContainText('8')
}

async function addRelatedOpenSourceProject(page: Page) {
  await page.getByTestId('property-action-add-relationship').click()
  await page.getByTestId('workspace-relationship-key-suggestion-related-to').click()
  await page.getByTestId('workspace-relationship-note-title-input').fill('Open Source')
  await page.getByTestId('workspace-relationship-note-suggestion-open-source-project').click()
  await page.getByTestId('workspace-action-sheet-addRelationship').getByRole('button', { name: 'Add' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId('relationship-row-how-i-run-an-open-source-project')).toBeVisible()
}

async function installFixtureHostWorkspace(page: Page, selectedNoteContent: string) {
  const snapshot = workspaceScenarioForId('default')

  await page.addInitScript(
    ({ contentKey, globalKey, key, path, selectedNoteContent, snapshot, value, writeKey }) => {
      Reflect.set(window, globalKey, snapshot)
      Reflect.set(window, contentKey, { [path]: selectedNoteContent })
      Reflect.set(window, writeKey, [])
      window.localStorage.setItem(key, value)
    },
    {
      contentKey: HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY,
      globalKey: HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY,
      key: HOST_WORKSPACE_SNAPSHOT_STORAGE_KEY,
      path: selectedNotePath,
      selectedNoteContent,
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

async function latestHostWorkspaceWriteContent(page: Page): Promise<string> {
  const latest = (await hostWorkspaceWrites(page)).at(-1)
  return latest && 'content' in latest ? latest.content : ''
}

function hydratedWorkflowMarkdown() {
  return [
    '---',
    'type: Essay',
    'Status: Active',
    '---',
    '# Workflow Orchestration Essay',
    '',
    'Hydrated host source content.',
    '',
  ].join('\n')
}
