import { expect, test, type Page } from '@playwright/test'
import { createTitledNoteFromQuickOpen, noteRowSlug } from './mobile-note-create-actions'

test.describe('mobile source block action parity', () => {
  test('edits desktop-compatible code, math, and Mermaid blocks from tablet More actions', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Source block More actions use the full-width tablet editor.')

    await page.goto('/')
    await createTabletNote(page, 'Source Block Note')
    await writeSourceBlocks(page)
    await editCodeBlock(page)
    await editMermaidBlock(page)
    await editMathBlock(page)
    await assertSourceBlocks(page)
  })
})

async function createTabletNote(page: Page, title: string) {
  await createTitledNoteFromQuickOpen(page, title)
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText(`${noteRowSlug(title)}.md`)
}

async function writeSourceBlocks(page: Page) {
  await page.getByTestId('editor-source-action').click()
  await expect(page.getByTestId('editor-markdown-input')).toBeVisible()
  await page.getByTestId('editor-markdown-input').fill([
    '# Source Block Note',
    '',
    '```js title="Old code" {1}',
    'console.log("old")',
    '```',
    '',
    '```mermaid title="Old graph"',
    'flowchart LR',
    '  A --> B',
    '```',
    '',
    '$$',
    'a^2 + b^2 = c^2',
    '$$',
  ].join('\n'))
  await page.getByTestId('editor-source-action').click()
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText('source-block-note.md')
}

async function editCodeBlock(page: Page) {
  await openSourceBlockEditor(page)
  await expect(page.getByTestId('workspace-source-block-language-input')).toHaveValue('js')
  await expect(page.getByTestId('workspace-source-block-metadata-input')).toHaveValue('title="Old code" {1}')
  await page.getByTestId('workspace-source-block-language-input').fill('ts')
  await page.getByTestId('workspace-source-block-metadata-input').fill('title="Typed code" {2}')
  await page.getByTestId('workspace-source-block-content-input').fill('const answer: number = 42')
  await saveSourceBlock(page)
}

async function editMermaidBlock(page: Page) {
  await openSourceBlockEditor(page)
  await page.getByTestId('workspace-source-block-option-1').click()
  await expect(page.getByTestId('workspace-source-block-metadata-input')).toHaveValue('title="Old graph"')
  await page.getByTestId('workspace-source-block-metadata-input').fill('title="Updated graph"')
  await expect(page.getByTestId('workspace-source-block-content-input')).toHaveValue(/flowchart LR/u)
  await page.getByTestId('workspace-source-block-content-input').fill('flowchart TD\n  Start --> Done')
  await saveSourceBlock(page)
}

async function editMathBlock(page: Page) {
  await openSourceBlockEditor(page)
  await page.getByTestId('workspace-source-block-option-2').click()
  await expect(page.getByTestId('workspace-source-block-content-input')).toHaveValue('a^2 + b^2 = c^2')
  await page.getByTestId('workspace-source-block-content-input').fill('E = mc^2')
  await saveSourceBlock(page)
}

async function openSourceBlockEditor(page: Page) {
  await page.getByTestId('editor-more-action').click()
  await page.getByTestId('workspace-action-group-edit').click()
  await page.getByTestId('workspace-action-edit-source-block').click()
  await expect(page.getByTestId('workspace-source-block-editor')).toBeVisible()
}

async function saveSourceBlock(page: Page) {
  await page.getByTestId('workspace-source-block-editor').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
}

async function assertSourceBlocks(page: Page) {
  await page.getByTestId('editor-source-action').click()
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/```ts title="Typed code" \{2\}\nconst answer: number = 42\n```/u)
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/```mermaid title="Updated graph"\nflowchart TD\n {2}Start --> Done\n```/u)
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/\$\$\nE = mc\^2\n\$\$/u)
}
