import { expect, test, type Page } from '@playwright/test'
import { createTitledNoteFromQuickOpen, noteRowSlug } from './mobile-note-create-actions'

test.describe('mobile table action parity', () => {
  test('edits desktop-compatible markdown tables from tablet More actions', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Table More actions use the full-width tablet editor.')

    await page.goto('/')
    await createTabletNote(page, 'Table Source')
    await writeMarkdownTable(page)
    await editMarkdownTable(page)
    await assertMarkdownTableSource(page)
  })
})

async function createTabletNote(page: Page, title: string) {
  await createTitledNoteFromQuickOpen(page, title)
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText(`${noteRowSlug(title)}.md`)
}

async function writeMarkdownTable(page: Page) {
  await page.getByTestId('editor-source-action').click()
  await expect(page.getByTestId('editor-markdown-input')).toBeVisible()
  await page.getByTestId('editor-markdown-input').fill([
    '# Table Source',
    '',
    '| Surface | Target |',
    '| :--- | ---: |',
    '| Editor | Mobile |',
  ].join('\n'))
  await page.getByTestId('editor-source-action').click()
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText('table-source.md')
}

async function editMarkdownTable(page: Page) {
  await page.getByTestId('editor-more-action').click()
  await page.getByTestId('workspace-action-group-edit').click()
  await page.getByTestId('workspace-action-edit-table').click()
  await expect(page.getByTestId('workspace-table-editor')).toBeVisible()
  await expect(page.getByTestId('workspace-table-header-input-0')).toHaveValue('Surface')
  await expect(page.getByTestId('workspace-table-header-input-1')).toHaveValue('Target')
  await page.getByTestId('workspace-table-alignment-1-center').click()
  await page.getByTestId('workspace-table-header-input-1').fill('Desktop')
  await page.getByTestId('workspace-table-cell-input-0-1').fill('Native')
  await page.getByRole('button', { exact: true, name: 'Add row' }).click()
  await page.getByRole('button', { exact: true, name: 'Add column' }).click()
  await page.getByTestId('workspace-table-alignment-2-left').click()
  await page.getByTestId('workspace-table-header-input-2').fill('Status')
  await page.getByTestId('workspace-table-cell-input-0-2').fill('Covered')
  await page.getByTestId('workspace-table-cell-input-1-0').fill('Inspector')
  await page.getByTestId('workspace-table-cell-input-1-1').fill('Properties')
  await page.getByTestId('workspace-table-cell-input-1-2').fill('Ready')
  await page.getByTestId('workspace-table-editor').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
}

async function assertMarkdownTableSource(page: Page) {
  await page.getByTestId('editor-source-action').click()
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/\| Surface \| Desktop \| Status \|/u)
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/\| :--- \| :---: \| :--- \|/u)
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/\| Editor \| Native \| Covered \|/u)
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/\| Inspector \| Properties \| Ready \|/u)
}
