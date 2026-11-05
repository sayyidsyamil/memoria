import { expect, test, type Page } from '@playwright/test'
import { createTitledNoteFromQuickOpen, noteRowSlug } from './mobile-note-create-actions'

test.describe('mobile whiteboard action parity', () => {
  test('edits desktop-compatible tldraw fences from tablet More actions', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Whiteboard More actions use the full-width tablet editor.')

    await page.goto('/')
    await createTabletNote(page, 'Whiteboard Source')
    await writeWhiteboardFence(page)
    await editWhiteboardFence(page)
    await assertWhiteboardFenceSource(page)
  })
})

async function createTabletNote(page: Page, title: string) {
  await createTitledNoteFromQuickOpen(page, title)
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText(`${noteRowSlug(title)}.md`)
}

async function writeWhiteboardFence(page: Page) {
  await page.getByTestId('editor-source-action').click()
  await expect(page.getByTestId('editor-markdown-input')).toBeVisible()
  await page.getByTestId('editor-markdown-input').fill([
    '# Whiteboard Source',
    '',
    '```tldraw id="qa-board" height="520"',
    '{}',
    '```',
  ].join('\n'))
  await page.getByTestId('editor-source-action').click()
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText('whiteboard-source.md')
}

async function editWhiteboardFence(page: Page) {
  await page.getByTestId('editor-more-action').click()
  await page.getByTestId('workspace-action-group-edit').click()
  await page.getByTestId('workspace-action-edit-whiteboard').click()
  await expect(page.getByTestId('workspace-whiteboard-editor')).toBeVisible()
  await expect(page.getByTestId('workspace-whiteboard-height-input')).toHaveValue('520')
  await page.getByTestId('workspace-whiteboard-height-input').fill('640')
  await page.getByTestId('workspace-whiteboard-width-input').fill('900')
  await page.getByTestId('workspace-whiteboard-snapshot-input').fill(JSON.stringify(desktopStoreSnapshot({ name: 'Tablet board' })))
  await page.getByTestId('workspace-whiteboard-text-shape-input').fill('Tablet board note')
  await page.getByTestId('workspace-whiteboard-structured-editor').getByRole('button', { name: 'Add' }).click()
  await expect(page.getByTestId('workspace-whiteboard-text-shape-0-input')).toHaveValue('Tablet board note')
  await page.getByTestId('workspace-whiteboard-text-shape-0-input').fill('Edited tablet board note')
  await page.getByTestId('workspace-whiteboard-text-shape-input').fill('Temporary tablet board note')
  await page.getByTestId('workspace-whiteboard-structured-editor').getByRole('button', { name: 'Add' }).click()
  await expect(page.getByTestId('workspace-whiteboard-text-shape-1-input')).toHaveValue('Temporary tablet board note')
  await page.getByTestId('workspace-whiteboard-text-shape-1').getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByTestId('workspace-whiteboard-text-shape-1')).toBeHidden()
  await page.getByTestId('workspace-whiteboard-editor').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
}

async function assertWhiteboardFenceSource(page: Page) {
  await page.getByTestId('editor-source-action').click()
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/```tldraw id="qa-board" height="640" width="900"/u)
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/"schemaVersion": 2/u)
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/Edited tablet board note/u)
  await expect(page.getByTestId('editor-markdown-input')).not.toHaveValue(/Temporary tablet board note/u)
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/"type": "text"/u)
}


function desktopStoreSnapshot({ name }: { name: string }) {
  return {
    schema: {
      schemaVersion: 2,
      sequences: {},
    },
    store: {
      'document:document': {
        gridSize: 20,
        id: 'document:document',
        meta: {},
        name,
        typeName: 'document',
      },
      'page:page': {
        id: 'page:page',
        index: 'a1',
        meta: {},
        name: 'Page 1',
        typeName: 'page',
      },
    },
  }
}
