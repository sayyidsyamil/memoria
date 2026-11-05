import { basename } from 'node:path'
import { expect, test } from '@playwright/test'
import { performance } from 'node:perf_hooks'
import { firstSidebarFolder, installLocalVaultSnapshot, localVaultPath, type LocalVaultSnapshotState } from './local-vault-snapshot-loader'
import { workspaceScenarioForId } from '../src/fixtures/workspaceFixtures'
import { HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY, HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY, HOST_WORKSPACE_SNAPSHOT_STORAGE_KEY } from '../src/workspace/readOnlyWorkspaceRepository'
import { expectSourceContainsSnippet } from './mobile-note-content-assertions'
import { mobileNoteDisplaysAsSheet } from '../src/workspace/mobileSpreadsheetFormat'
import type { Page as PageLike } from '@playwright/test'
import { expectSelectedChromeTitle } from './mobile-workspace-property-flows'

export async function installRequiredLocalVaultSnapshot(page: PageLike): Promise<LocalVaultSnapshotState> {
  const state = await installLocalVaultSnapshot(page)
  test.skip(!state, `Local vault path is not readable: ${localVaultPath}`)
  if (!state) throw new Error(`Local vault path is not readable: ${localVaultPath}`)
  return state
}

export async function installFixtureHostWorkspace(page: PageLike) {
  const snapshot = workspaceScenarioForId('default')

  await page.addInitScript(
    ({ contentKey, globalKey, key, snapshot, value }) => {
      Reflect.set(window, globalKey, snapshot)
      Reflect.set(window, contentKey, {})
      window.localStorage.setItem(key, value)
    },
    {
      contentKey: HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY,
      globalKey: HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY,
      key: HOST_WORKSPACE_SNAPSHOT_STORAGE_KEY,
      snapshot,
      value: JSON.stringify(snapshot),
    },
  )
}

export async function hostWorkspaceWriteCount(page: PageLike): Promise<number> {
  return page.evaluate(() => {
    const writes = (window as unknown as { __MEMORIA_MOBILE_WORKSPACE_WRITES__?: unknown[] }).__MEMORIA_MOBILE_WORKSPACE_WRITES__
    return writes?.length ?? 0
  })
}

export function assertSnapshotBuildBudgets(state: LocalVaultSnapshotState) {
  expect(state.fileCount).toBeGreaterThan(0)
  expect(state.totalDurationMs).toBeLessThan(10_000)
  expect(state.buildDurationMs).toBeLessThan(1_000)
}

export async function assertLocalVaultRenderBudget(page: PageLike, state: LocalVaultSnapshotState) {
  const firstNote = state.snapshot.notes[0]
  if (!firstNote) throw new Error('Expected at least one visible local-vault note.')

  const renderDurationMs = await measureDuration(async () => {
    await page.goto('/?source=host-vault')
    await expect(page.getByText(firstNote.title).first()).toBeVisible()
  })
  expect(renderDurationMs).toBeLessThan(3_000)
}

export async function assertNoteSwitchBudget(page: PageLike, state: LocalVaultSnapshotState) {
  const secondNote = state.snapshot.notes[1]
  if (!secondNote) throw new Error('Expected at least two visible local-vault notes.')

  const noteSwitchDurationMs = await measureDuration(async () => {
    await page.getByTestId(`note-row-${secondNote.id}`).click()
    await expect(page.getByTestId('editor-toolbar-title')).toHaveText(basename(secondNote.path ?? secondNote.id))
  })
  expect(noteSwitchDurationMs).toBeLessThan(700)
}

export async function assertHiddenNoteHydrationAndWrite(page: PageLike, state: LocalVaultSnapshotState) {
  const hiddenNote = state.snapshot.allNotes?.find((note) => {
    const visibleIds = new Set(state.snapshot.notes.map((candidate) => candidate.id))
    return !visibleIds.has(note.id)
      && note.path
      && note.fileKind === 'markdown'
      && !mobileNoteDisplaysAsSheet({ ...note, rawContent: state.noteContents[note.path] })
      && state.noteContents[note.path]
  })
  if (!hiddenNote?.path) return

  await page.getByTestId('note-list-search-action').click()
  await page.getByTestId('workspace-search-input').fill(hiddenNote.path)
  await page.getByTestId(`workspace-search-result-${hiddenNote.id}`).click()
  await expectSelectedChromeTitle(page, basename(hiddenNote.path))
  await expectSourceContainsSnippet(page, hiddenNote.snippet)

  await page.getByTestId('editor-markdown-input').fill(`# ${hiddenNote.title}\n\nMobile hydration write check.\n`)
  await page.waitForTimeout(300)

  const writes = await page.evaluate(() => {
    const globalWrites = (window as unknown as { __MEMORIA_MOBILE_WORKSPACE_WRITES__?: unknown[] }).__MEMORIA_MOBILE_WORKSPACE_WRITES__
    return globalWrites ?? []
  })
  expect(writes).toContainEqual(expect.objectContaining({
    kind: 'saveNote',
    path: hiddenNote.path,
  }))
  expect(JSON.stringify(writes)).toContain(`# ${hiddenNote.title}\\n\\nMobile hydration write check.`)
}

export async function assertTypeNavigationBudget(page: PageLike, state: LocalVaultSnapshotState) {
  const typeItem = state.snapshot.sidebarSections.find((section) => section.id === 'types')?.items?.[0]
  if (!typeItem) return

  const typeNavigationDurationMs = await measureDuration(async () => {
    await page.getByRole('button', { name: typeItem.label }).click()
    await expect(page.getByTestId('note-list-toolbar-title')).toHaveText(typeItem.label)
  })
  expect(typeNavigationDurationMs).toBeLessThan(700)
}

export async function assertSavedViewNavigationBudget(page: PageLike, state: LocalVaultSnapshotState) {
  const viewItem = state.snapshot.sidebarSections.find((section) => section.id === 'views')?.items?.[0]
  if (!viewItem) return

  const viewNavigationDurationMs = await measureDuration(async () => {
    await page.getByRole('button', { name: viewItem.label }).click()
    await expect(page.getByTestId('note-list-toolbar-title')).toHaveText(viewItem.label)
  })
  expect(viewNavigationDurationMs).toBeLessThan(700)
}

export async function assertFolderNavigationBudget(page: PageLike, state: LocalVaultSnapshotState) {
  const folder = firstSidebarFolder(state.snapshot)
  if (!folder) return
  const folderButton = page.getByRole('button', { name: folder.name }).first()
  await folderButton.scrollIntoViewIfNeeded()

  const folderNavigationDurationMs = await measureDuration(async () => {
    await folderButton.click()
    await expect(page.getByTestId('note-list-toolbar-title')).toHaveText(folder.name)
  })
  expect(folderNavigationDurationMs).toBeLessThan(700)
}

async function measureDuration(action: () => Promise<void>): Promise<number> {
  const startedAt = performance.now()
  await action()
  return performance.now() - startedAt
}
