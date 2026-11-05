import { expect, test, type Page } from '@playwright/test'
import { createTitledNoteFromQuickOpen, noteRowSlug } from './mobile-note-create-actions'

test.describe('phone whiteboard action parity', () => {
  test('edits desktop-compatible tldraw fences from phone More actions', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-portrait', 'Phone whiteboard actions run on the phone editor shell.')

    await page.goto('/')
    await createPhoneNote(page, 'Phone Whiteboard Source')
    await writeWhiteboardFence(page)
    await editWhiteboardFence(page)
    await assertWhiteboardFenceSource(page)
  })
})

async function createPhoneNote(page: Page, title: string) {
  await createTitledNoteFromQuickOpen(page, title)
  await page.getByTestId(`note-row-${noteRowSlug(title)}.md`).click()
  await expect(page.getByTestId('phone-editor-screen')).toBeVisible()
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText(`${noteRowSlug(title)}.md`)
}

async function writeWhiteboardFence(page: Page) {
  await page.getByTestId('editor-source-action').click()
  await expect(page.getByTestId('editor-markdown-input')).toBeVisible()
  await page.getByTestId('editor-markdown-input').fill([
    '# Phone Whiteboard Source',
    '',
    '```tldraw id="phone-board" height="520"',
    '{}',
    '```',
  ].join('\n'))
  await page.getByTestId('editor-source-action').click()
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText('phone-whiteboard-source.md')
}

async function editWhiteboardFence(page: Page) {
  await page.getByTestId('editor-more-action').click()
  await page.getByTestId('workspace-action-group-edit').click()
  await page.getByTestId('workspace-action-edit-whiteboard').click()
  await expect(page.getByTestId('workspace-whiteboard-editor')).toBeVisible()
  await expect(page.getByTestId('workspace-whiteboard-height-input')).toHaveValue('520')
  await page.getByTestId('workspace-whiteboard-height-input').fill('640')
  await page.getByTestId('workspace-whiteboard-width-input').fill('900')
  await page.getByTestId('workspace-whiteboard-snapshot-input').fill(JSON.stringify(desktopStoreSnapshot({ name: 'Phone board' })))
  await page.getByTestId('workspace-whiteboard-text-shape-input').fill('Phone board note')
  await page.getByTestId('workspace-whiteboard-structured-editor').getByRole('button', { name: 'Add' }).click()
  await expect(page.getByTestId('workspace-whiteboard-text-shape-0-input')).toHaveValue('Phone board note')
  await page.getByTestId('workspace-whiteboard-text-shape-0-input').fill('Edited phone board note')
  await page.getByTestId('workspace-whiteboard-text-shape-input').fill('Temporary phone board note')
  await page.getByTestId('workspace-whiteboard-structured-editor').getByRole('button', { name: 'Add' }).click()
  await expect(page.getByTestId('workspace-whiteboard-text-shape-1-input')).toHaveValue('Temporary phone board note')
  await page.getByTestId('workspace-whiteboard-text-shape-1').getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByTestId('workspace-whiteboard-text-shape-1')).toBeHidden()
  await page.getByTestId('workspace-whiteboard-editor').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
}

async function assertWhiteboardFenceSource(page: Page) {
  await page.getByTestId('editor-source-action').click()
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/```tldraw id="phone-board" height="640" width="900"/u)
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/"schemaVersion": 2/u)
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/Edited phone board note/u)
  await expect(page.getByTestId('editor-markdown-input')).not.toHaveValue(/Temporary phone board note/u)
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
