import { openPhoneSidebar, phoneBack } from './mobile-panel-navigation'
import { latestClipboardAttempt } from './mobile-browser-attempts'
import { expect, test, type Page } from '@playwright/test'
import { buildLocalVaultWorkspaceSnapshot, mobileFileKindForPath, type LocalVaultFile } from '../src/workspace/localVaultSnapshot'
import {
  HOST_WORKSPACE_NOTE_CONTENTS_GLOBAL_KEY,
  HOST_WORKSPACE_SNAPSHOT_GLOBAL_KEY,
  HOST_WORKSPACE_SNAPSHOT_STORAGE_KEY,
} from '../src/workspace/readOnlyWorkspaceRepository'

test.describe('mobile non-markdown file action parity', () => {
  test('exposes active file actions for selected text and binary vault entries', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'File entry action checks use the full-width tablet layout.')

    await installFileEntryHostWorkspace(page)
    await page.goto('/?source=host-vault')
    await page.getByRole('button', { name: 'Files' }).click()
    await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Files')

    await page.getByTestId('note-row-Files/config.yml').click()
    await expect(page.getByTestId('editor-text-file-input')).toBeVisible()
    await assertFileActionSheet(page, {
      copiedPath: 'Files/config.yml',
      fileTitle: 'Mobile Config',
      hasNeighborhoodAction: true,
      fileNoteId: 'Files/config.yml',
    })
    await openSelectedFileNeighborhood(page, 'Mobile Config', 'note-row-Files/config.yml')
    await page.getByRole('button', { name: 'Files' }).click()
    await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Files')

    await page.getByTestId('note-row-Files/diagram.png').click()
    await expect(page.getByTestId('file-preview-fallback')).toBeVisible()
    await assertFileActionSheet(page, {
      copiedPath: 'Files/diagram.png',
      fileTitle: 'diagram.png',
      hasNeighborhoodAction: false,
      fileNoteId: 'Files/diagram.png',
    })
    await deleteSelectedFileFromMoreSheet(page, 'note-row-Files/diagram.png')
  })

  test('exposes active file actions from the phone editor more sheet', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-portrait', 'Phone file entry action checks use the phone editor shell.')

    await installFileEntryHostWorkspace(page)
    await page.goto('/?source=host-vault')
    await openPhoneFolder(page, 'Files')

    await page.getByTestId('note-row-Files/config.yml').click()
    await expect(page.getByTestId('phone-editor-screen')).toBeVisible()
    await expect(page.getByTestId('editor-text-file-input')).toBeVisible()
    await assertFileActionSheet(page, {
      copiedPath: 'Files/config.yml',
      fileTitle: 'Mobile Config',
      hasNeighborhoodAction: true,
      fileNoteId: 'Files/config.yml',
    })
    await openSelectedFileNeighborhood(page, 'Mobile Config', 'note-row-Files/config.yml')
    await openPhoneFolder(page, 'Files')

    await page.getByTestId('note-row-Files/diagram.png').click()
    await expect(page.getByTestId('phone-editor-screen')).toBeVisible()
    await expect(page.getByTestId('file-preview-fallback')).toBeVisible()
    await assertFileActionSheet(page, {
      copiedPath: 'Files/diagram.png',
      fileTitle: 'diagram.png',
      hasNeighborhoodAction: false,
      fileNoteId: 'Files/diagram.png',
    })
    await deleteSelectedFileFromMoreSheet(page, 'note-row-Files/diagram.png')
    await phoneBack(page)
    await expect(page.getByTestId('note-row-Files/diagram.png')).toBeHidden()
  })
})

async function assertFileActionSheet(
  page: Page,
  {
    copiedPath,
    fileTitle,
    hasNeighborhoodAction,
    fileNoteId,
  }: {
    copiedPath: string
    fileTitle: string
    hasNeighborhoodAction: boolean
    fileNoteId: string
  },
) {
  await page.getByTestId('editor-more-action').click()
  if (hasNeighborhoodAction) {
    await expect(page.getByTestId('workspace-action-open-neighborhood')).toBeVisible()
  } else {
    await expect(page.getByTestId('workspace-action-open-neighborhood')).toBeHidden()
  }
  await expect(page.getByTestId('workspace-action-copy-file-path')).toBeVisible()
  await expect(page.getByTestId('workspace-action-open-default-app')).toBeVisible()
  await expect(page.getByTestId('workspace-action-reveal-file')).toHaveCount(0)
  await expect(page.getByTestId('workspace-action-copy-deep-link')).toBeVisible()
  await expect(page.getByTestId('workspace-action-delete-note')).toBeVisible()
  await expect(page.getByTestId('workspace-action-table-of-contents')).toBeHidden()
  await expect(page.getByTestId('workspace-action-export-pdf')).toBeHidden()

  await page.getByTestId('workspace-action-copy-file-path').click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(latestClipboardAttempt(page)).resolves.toBe(copiedPath)

  await page.getByTestId('editor-more-action').click()
  await page.getByTestId('workspace-action-open-default-app').click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(latestFileOpenAttempt(page)).resolves.toEqual({
    noteId: fileNoteId,
    path: copiedPath,
    title: fileTitle,
  })
}

async function openSelectedFileNeighborhood(page: Page, title: string, rowTestId: string) {
  await page.getByTestId('editor-more-action').click()
  await page.getByTestId('workspace-action-open-neighborhood').click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText(title)
  await expect(page.getByTestId(rowTestId)).toBeVisible()
}

async function deleteSelectedFileFromMoreSheet(page: Page, rowTestId: string) {
  await page.getByTestId('editor-more-action').click()
  await page.getByTestId('workspace-action-delete-note').click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId(rowTestId)).toBeHidden()
}

function latestFileOpenAttempt(page: Page) {
  return page.evaluate(() => {
    const value = Reflect.get(window, '__MEMORIA_MOBILE_FILE_OPEN_ATTEMPTS__')
    return Array.isArray(value) ? value.at(-1) : null
  })
}

async function installFileEntryHostWorkspace(page: Page) {
  const snapshot = buildLocalVaultWorkspaceSnapshot({
    files: [
      vaultFile('Inbox.md', '# Inbox\n\nA normal markdown note.\n', 0),
      vaultFile('Files/config.yml', 'name: Mobile Config\nstatus: active\n', 1),
      vaultFile('Files/diagram.png', '', 2),
    ],
    folderPaths: ['Files'],
    vaultAlias: 'tv',
    vaultLabel: 'Memoria Vault',
    vaultPath: '/Mobile/Test Vault',
  })
  const noteContents = {
    'Inbox.md': '# Inbox\n\nA normal markdown note.\n',
    'Files/config.yml': 'name: Mobile Config\nstatus: active\n',
  }

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

async function openPhoneFolder(page: Page, folderName: string) {
  await openPhoneSidebar(page)
  await expect(page.getByTestId('phone-sidebar-screen')).toBeVisible()
  await page.getByRole('button', { exact: true, name: folderName }).click()
  await expect(page.getByTestId('phone-note-list-screen')).toBeVisible()
  await expect(page.getByTestId('note-list-toolbar-title')).toHaveText(folderName)
}

function vaultFile(relativePath: string, content: string, index: number): LocalVaultFile {
  return {
    absolutePath: `/Mobile/Test Vault/${relativePath}`,
    content,
    createdAt: 1_700_000_000_000 + index,
    fileKind: mobileFileKindForPath(relativePath),
    modifiedAt: 1_700_000_000_000 + index,
    relativePath,
    size: content.length,
  }
}
