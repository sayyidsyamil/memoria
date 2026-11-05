import { expect, test, type Page } from '@playwright/test'
import { openPhoneSidebar } from './mobile-panel-navigation'
import { workspaceScenarioForId } from '../src/fixtures/workspaceFixtures'
import {
  HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY,
  HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY,
  HOST_WORKSPACE_SNAPSHOT_STORAGE_KEY,
  HOST_WORKSPACE_WRITES_GLOBAL_KEY,
} from '../src/workspace/readOnlyWorkspaceRepository'
import type { MobileWorkspaceWrite } from '../src/workspace/mobileWorkspaceEditing'
import { createTitledNoteFromQuickOpen, noteRowSlug } from './mobile-note-create-actions'

import { fileRevealAttempts, latestClipboardAttempt } from './mobile-browser-attempts'

test.describe('mobile command palette actions', () => {
  test('dispatches selected-note utility commands from the tablet command palette', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Command palette action checks use the full-width tablet layout.')

    await page.goto('/')
    await openCommandPalette(page)
    await runCommand(page, 'copy path', 'copy-active-file-path')

    await expect(page.getByTestId('mobile-command-palette')).toBeHidden()
    await expect.poll(() => latestClipboardAttempt(page)).toBe(
      'Memoria/Mobile UI/Workflow Orchestration Essay.md',
    )

    await openCommandPalette(page)
    await runCommand(page, 'move folder', 'move-note-to-folder')

    await expect(page.getByTestId('mobile-command-palette')).toBeHidden()
    await expect(page.getByTestId('workspace-move-folder-input')).toBeVisible()
  })

  test('creates typed notes from desktop-style dynamic commands', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Command palette action checks use the full-width tablet layout.')

    await page.goto('/')
    await openCommandPalette(page)
    await runCommand(page, 'new essay', 'new-essay')

    await expect(page.getByTestId('mobile-command-palette')).toBeHidden()
    await expect(page.getByTestId(/note-row-untitled-essay-\d+\.md/u)).toBeVisible()
    await expect(page.getByTestId('editor-toolbar-title')).toHaveText(/^untitled-essay-\d+\.md$/u)
    await expect(page.getByTestId('editor-title')).toBeHidden()
    await expect(page.getByTestId('property-row-type-edit')).toHaveText('Essay')
  })

  test('opens active note-list column customization from the tablet command palette', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Command palette action checks use the full-width tablet layout.')

    await page.goto('/')
    await page.getByTestId('sidebar-item-all-notes').click()
    await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('All Notes')

    await openCommandPalette(page)
    await runCommand(page, 'customize all columns', 'customize-note-list-columns')

    await expect(page.getByTestId('mobile-command-palette')).toBeHidden()
    await expect(page.getByTestId('workspace-action-sheet-editPrimaryListProperties')).toBeVisible()
    await expect(page.getByTestId('workspace-all-notes-file-visibility')).toBeVisible()
  })

  test('dispatches workspace history commands from the tablet command palette', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Command palette action checks use the full-width tablet layout.')

    await page.goto('/')
    await page.getByTestId('sidebar-item-all-notes').click()
    await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('All Notes')

    await openCommandPalette(page)
    await runCommand(page, 'go back', 'view-go-back')

    await expect(page.getByTestId('mobile-command-palette')).toBeHidden()
    await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Inbox')

    await openCommandPalette(page)
    await runCommand(page, 'go forward', 'view-go-forward')

    await expect(page.getByTestId('mobile-command-palette')).toBeHidden()
    await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('All Notes')
  })

  test('dispatches default note-width commands from the tablet command palette', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Command palette action checks use the full-width tablet layout.')

    await page.goto('/')
    await openCommandPalette(page)
    await runCommand(page, 'wide default', 'set-default-note-width-wide')

    await expect(page.getByTestId('mobile-command-palette')).toBeHidden()

    await openCommandPalette(page)
    await page.getByTestId('mobile-command-palette-input').fill('normal default')

    await expect(page.getByTestId('mobile-command-palette-command-set-default-note-width-normal')).toBeVisible()
    await page.getByTestId('mobile-command-palette-command-set-default-note-width-normal').click()
    await expect(page.getByTestId('mobile-command-palette')).toBeHidden()
  })

  test('reloads the active workspace from the tablet command palette', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Command palette action checks use the full-width tablet layout.')

    const title = 'Reloadable Command Draft'
    const rowTestId = `note-row-${noteRowSlug(title)}.md`

    await page.goto('/')
    await createTitledNoteFromQuickOpen(page, title, rowTestId)

    await openCommandPalette(page)
    await runCommand(page, 'reload vault', 'vault-reload')

    await expect(page.getByTestId('mobile-command-palette')).toBeHidden()
    await expect(page.getByTestId(rowTestId)).toBeHidden()
  })

  for (const device of ['tablet', 'phone']) {
    test(`flushes the active source editor draft from the ${device} command palette save command`, async ({ page }, testInfo) => {
      const phone = device === 'phone'
      test.skip(testInfo.project.name !== (phone ? 'phone-portrait' : 'tablet-landscape'))
      await assertSourceEditorDraftSavesFromCommandPalette(page, {
        initialMarkdown: `# Workflow Orchestration Essay\n\nOriginal ${device} host body.\n`,
        markdown: `# Workflow Orchestration Essay\n\nSaved from the live ${device} source editor command.\n`,
        openPalette: phone ? openPhoneCommandPalette : openCommandPalette,
        screenTestId: phone ? 'phone-editor-screen' : undefined,
        url: `/?source=host-vault&editorMode=source&disableEditorIdleSave=1${phone ? '&phoneState=editor' : ''}`,
      })
    })
  }

  test('dispatches workspace commands from the phone command palette', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-portrait', 'Phone command palette checks run on the phone shell.')

    const title = 'Phone Reloadable Command Draft'
    const rowTestId = `note-row-${noteRowSlug(title)}.md`

    await page.goto('/')
    await openPhoneCommandPalette(page)
    await runCommand(page, 'wide default', 'set-default-note-width-wide')
    await expect(page.getByTestId('mobile-command-palette')).toBeHidden()

    await openPhoneCommandPalette(page)
    await page.getByTestId('mobile-command-palette-input').fill('normal default')
    await expect(page.getByTestId('mobile-command-palette-command-set-default-note-width-normal')).toBeVisible()
    await page.getByTestId('mobile-command-palette-command-set-default-note-width-normal').click()
    await expect(page.getByTestId('mobile-command-palette')).toBeHidden()
    await page.getByTestId('phone-sidebar-screen').getByTestId('sidebar-item-all-notes').click()
    await expect(page.getByTestId('phone-note-list-screen')).toBeVisible()

    await createTitledNoteFromQuickOpen(page, title, rowTestId)

    await openPhoneCommandPalette(page)
    await runCommand(page, 'reload vault', 'vault-reload')
    await expect(page.getByTestId('mobile-command-palette')).toBeHidden()
    await expect(page.getByTestId(rowTestId)).toBeHidden()
  })

  test('dispatches selected-folder commands from the tablet command palette', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Command palette action checks use the full-width tablet layout.')

    await page.goto('/')
    await page.getByRole('button', { exact: true, name: 'Mobile UI' }).click()
    await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Mobile UI')

    await openCommandPalette(page)
    await runCommand(page, 'reveal', 'reveal-selected-folder')

    await expect(page.getByTestId('mobile-command-palette')).toBeHidden()
    await expect.poll(async () => (await fileRevealAttempts(page)).at(-1)).toEqual({
      folderPath: 'Memoria/Mobile UI',
      path: 'Memoria/Mobile UI',
    })

    await openCommandPalette(page)
    await runCommand(page, 'copy folder path', 'copy-selected-folder-path')

    await expect(page.getByTestId('mobile-command-palette')).toBeHidden()
    await expect.poll(() => latestClipboardAttempt(page)).toBe('Memoria/Mobile UI')

    await openCommandPalette(page)
    await runCommand(page, 'rename folder', 'rename-folder')

    await expect(page.getByTestId('mobile-command-palette')).toBeHidden()
    await expect(page.getByTestId('workspace-action-sheet-editFolder')).toBeVisible()
    await expect(page.getByTestId('workspace-rename-folder-input')).toHaveValue('Mobile UI')

    await page.getByTestId('workspace-action-reveal-folder').click()

    await expect(page.getByTestId('workspace-action-sheet-editFolder')).toBeHidden()
    await expect.poll(async () => (await fileRevealAttempts(page)).length).toBe(2)
  })
})

async function openCommandPalette(page: Page) {
  await page.getByTestId('sidebar-command-palette-action').click()
  await expect(page.getByTestId('mobile-command-palette')).toBeVisible()
  await expect(page.getByTestId('mobile-command-palette-input')).toBeFocused()
}

async function openPhoneCommandPalette(page: Page) {
  if (await page.getByTestId('phone-editor-screen').isVisible()) {
    await page.keyboard.press('Meta+k')
  } else {
    await openPhoneSidebar(page)
    await page.getByTestId('phone-sidebar-screen').getByTestId('sidebar-command-palette-action').click()
  }
  await expect(page.getByTestId('mobile-command-palette')).toBeVisible()
  await expect(page.getByTestId('mobile-command-palette-input')).toBeFocused()
}

async function runCommand(page: Page, query: string, commandId: string) {
  await page.getByTestId('mobile-command-palette-input').fill(query)
  await page.getByTestId(`mobile-command-palette-command-${commandId}`).click()
}

type SourceEditorSaveOptions = {
  initialMarkdown: string
  markdown: string
  openPalette: (page: Page) => Promise<void>
  screenTestId?: string
  url: string
}

async function assertSourceEditorDraftSavesFromCommandPalette(page: Page, options: SourceEditorSaveOptions) {
  await installFixtureHostWorkspace(page, options.initialMarkdown)
  await page.goto(options.url)
  if (options.screenTestId) {
    await expect(page.getByTestId(options.screenTestId)).toBeVisible()
  }
  const editor = page.getByTestId('editor-markdown-input')
  await expect(editor).toBeVisible()
  await expect(editor).toHaveValue(options.initialMarkdown)
  await editor.fill(options.markdown)
  await expect(hostWorkspaceWrites(page)).resolves.toEqual([])

  await options.openPalette(page)
  await runCommand(page, 'save note', 'file-save')

  await expect(page.getByTestId('mobile-command-palette')).toBeHidden()
  await expect.poll(() => hostWorkspaceWrites(page)).toEqual([
    expect.objectContaining({
      content: options.markdown,
      kind: 'saveNote',
    }),
  ])
}

async function installFixtureHostWorkspace(page: Page, selectedNoteContent: string) {
  const snapshot = workspaceScenarioForId('default')
  const selectedNote = snapshot.notes.find((note) => note.id === snapshot.selectedNoteId) ?? snapshot.notes[0]
  const noteContents = selectedNote?.path ? { [selectedNote.path]: selectedNoteContent } : {}

  await page.addInitScript(
    ({ contentKey, globalKey, key, noteContents, snapshot, value }) => {
      Reflect.set(window, globalKey, snapshot)
      Reflect.set(window, contentKey, noteContents)
      window.localStorage.setItem(key, value)
    },
    {
      contentKey: HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY,
      globalKey: HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY,
      key: HOST_WORKSPACE_SNAPSHOT_STORAGE_KEY,
      noteContents,
      snapshot,
      value: JSON.stringify(snapshot),
    },
  )
}

async function hostWorkspaceWrites(page: Page): Promise<MobileWorkspaceWrite[]> {
  return page.evaluate((globalKey) => {
    const writes = (window as unknown as Record<string, unknown>)[globalKey]
    return Array.isArray(writes) ? writes : []
  }, HOST_WORKSPACE_WRITES_GLOBAL_KEY) as Promise<MobileWorkspaceWrite[]>
}
