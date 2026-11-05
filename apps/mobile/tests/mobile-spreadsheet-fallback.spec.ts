import { expect, test } from '@playwright/test'

test('@smoke spreadsheet rich mode never rewrites CSV or frontmatter and raw mode remains editable', async ({ page }) => {
  await page.goto('/?source=fixture&phoneState=editor&editorMode=source')
  const source = page.getByTestId('editor-markdown-input')
  const original = '---\ntype: Note\n_display: sheet\n_sheet:\n  frozen_rows: 1\n---\nName,Value\nTotal,=SUM(B1:B2)\n'
  await source.fill(original)
  await page.getByTestId('editor-source-action').click()
  await expect(page.getByTestId('spreadsheet-unsupported')).toHaveText('Spreadsheets not supported on mobile yet')
  await expect(source).toBeHidden()
  await expect(page.getByTestId('editor-formatting-toolbar')).toBeHidden()
  await page.getByTestId('editor-source-action').click()
  await expect(source).toHaveValue(original)
  const edited = `${original}Added,42\n`
  await source.fill(edited)
  await page.getByTestId('editor-source-action').click()
  await expect(page.getByTestId('spreadsheet-unsupported')).toBeVisible()
  await page.getByTestId('editor-source-action').click()
  await expect(source).toHaveValue(edited)
})
