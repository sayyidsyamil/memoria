import { expect, test, type Page } from '@playwright/test'
import { createTitledNoteFromQuickOpen, noteRowSlug } from './mobile-note-create-actions'

test.describe('phone source block action parity', () => {
  test('edits desktop-compatible source blocks from phone More actions', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-portrait', 'Phone source block actions run on the phone editor shell.')

    await page.goto('/')
    await createPhoneNote(page, 'Phone Source Blocks')
    await writeSourceBlocks(page)
    await editCodeBlock(page)
    await editMathBlock(page)
    await editMermaidBlock(page)
    await assertSourceBlocks(page)
  })
})

async function createPhoneNote(page: Page, title: string) {
  await createTitledNoteFromQuickOpen(page, title)
  await page.getByTestId(`note-row-${noteRowSlug(title)}.md`).click()
  await expect(page.getByTestId('phone-editor-screen')).toBeVisible()
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText(`${noteRowSlug(title)}.md`)
}

async function writeSourceBlocks(page: Page) {
  await page.getByTestId('editor-source-action').click()
  await expect(page.getByTestId('editor-markdown-input')).toBeVisible()
  await page.getByTestId('editor-markdown-input').fill([
    '# Phone Source Blocks',
    '',
    '```js title="Old phone code"',
    'console.log("phone")',
    '```',
    '',
    '$$',
    'a^2 + b^2 = c^2',
    '$$',
    '',
    '```mermaid title="Old phone graph"',
    'flowchart LR',
    '  A --> B',
    '```',
  ].join('\n'))
  await page.getByTestId('editor-source-action').click()
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText('phone-source-blocks.md')
}

async function editCodeBlock(page: Page) {
  await openSourceBlockEditor(page)
  await expect(page.getByTestId('workspace-source-block-language-input')).toHaveValue('js')
  await expect(page.getByTestId('workspace-source-block-metadata-input')).toHaveValue('title="Old phone code"')
  await page.getByTestId('workspace-source-block-language-input').fill('ts')
  await page.getByTestId('workspace-source-block-metadata-input').fill('title="Typed phone code"')
  await page.getByTestId('workspace-source-block-content-input').fill('const phoneAnswer: number = 42')
  await saveSourceBlock(page)
}

async function editMathBlock(page: Page) {
  await openSourceBlockEditor(page)
  await page.getByTestId('workspace-source-block-option-1').click()
  await expect(page.getByTestId('workspace-source-block-content-input')).toHaveValue('a^2 + b^2 = c^2')
  await page.getByTestId('workspace-source-block-content-input').fill('E = mc^2')
  await saveSourceBlock(page)
}

async function editMermaidBlock(page: Page) {
  await openSourceBlockEditor(page)
  await page.getByTestId('workspace-source-block-option-2').click()
  await expect(page.getByTestId('workspace-source-block-metadata-input')).toHaveValue('title="Old phone graph"')
  await page.getByTestId('workspace-source-block-metadata-input').fill('title="Updated phone graph"')
  await page.getByTestId('workspace-source-block-content-input').fill('flowchart TD\n  Start --> Done')
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
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/```ts title="Typed phone code"\nconst phoneAnswer: number = 42\n```/u)
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/\$\$\nE = mc\^2\n\$\$/u)
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/```mermaid title="Updated phone graph"\nflowchart TD\n {2}Start --> Done\n```/u)
}
