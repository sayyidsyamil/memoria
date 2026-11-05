import { expect, test, type Page } from '@playwright/test'

const originalFilename = 'Workflow Orchestration Essay.md'

test('renames a filename inline without changing the note content', async ({ page }) => {
  await openFilename(page)
  const content = await page.getByTestId('editor-markdown-input').inputValue()
  await page.getByTestId('editor-filename-input').fill('renamed-from-breadcrumb.md')
  await page.getByTestId('editor-filename-input').press('Enter')
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText('renamed-from-breadcrumb.md')
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(content)
  await expect(page.getByTestId('workspace-action-sheet')).toHaveCount(0)

  await page.getByTestId('editor-filename-action').click()
  await page.getByTestId('editor-filename-input').fill('cancelled.md')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('editor-filename-input')).toHaveCount(0)
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText('renamed-from-breadcrumb.md')
})

test('rejects empty, invalid and colliding inline names', async ({ page }) => {
  await openFilename(page)
  const input = page.getByTestId('editor-filename-input')
  const save = page.getByTestId('editor-filename-save')
  for (const name of ['', '../outside.md', 'How I Run an Open Source Project.md']) {
    await input.fill(name)
    await expect(save).toBeDisabled()
  }
  await input.fill('valid-note.md')
  await expect(save).toBeEnabled()
  await page.getByTestId('editor-filename-cancel').click()
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText(originalFilename)
})

async function openFilename(page: Page) {
  await page.goto('/?source=fixture&phoneState=editor&editorMode=source')
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText(originalFilename)
  await page.getByTestId('editor-filename-action').click()
  await expect(page.getByTestId('editor-filename-input')).toBeFocused()
  await expect(page.getByTestId('editor-filename-input')).toHaveValue(originalFilename)
}
