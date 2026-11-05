import { expect, test } from '@playwright/test'

test('keeps note actions compact and separates editing from file operations', async ({ page }, info) => {
  await page.goto('/?source=fixture&phoneState=editor')
  await page.getByTestId('editor-more-action').click()
  const note = page.getByTestId('workspace-action-group-note')
  await expect(note).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('workspace-action-archive-note')).toBeVisible()
  await expect(page.getByTestId('workspace-action-set-note-icon')).toHaveCount(0)
  await expect(page.getByTestId('workspace-action-change-note-type')).toHaveCount(0)
  await expect(page.getByTestId('workspace-action-rename-file')).toBeHidden()
  await expect(page.getByTestId('workspace-action-find-in-note')).toBeHidden()

  await page.getByTestId('workspace-action-group-edit').click()
  await expect(page.getByTestId('workspace-action-find-in-note')).toBeVisible()
  if (info.project.name === 'phone-portrait') {
    await expect(page.getByTestId('workspace-action-table-of-contents')).toHaveCount(0)
  } else {
    await expect(page.getByTestId('workspace-action-table-of-contents')).toBeVisible()
  }
  await expect(page.getByTestId('workspace-action-delete-note')).toBeHidden()

  await page.getByTestId('workspace-action-group-file').click()
  await expect(page.getByTestId('workspace-action-rename-file')).toBeVisible()
  await expect(page.getByTestId('workspace-action-copy-file-path')).toBeVisible()
  await expect(page.getByTestId('workspace-action-reveal-file')).toHaveCount(0)
  await expect(page.getByTestId('workspace-action-export-pdf')).toBeVisible()
  await expect(page.getByTestId('workspace-action-find-in-note')).toBeHidden()
  for (const id of ['workspace-action-group-file', 'workspace-action-copy-file-path']) {
    const geometry = await page.getByTestId(id).evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      minHeight: getComputedStyle(element).minHeight,
      inlineStyle: element.getAttribute('style'),
    }))
    expect(geometry.height, `${id}: ${JSON.stringify(geometry)}`).toBeGreaterThanOrEqual(44)
  }
  await note.click()
  await expect(page.getByTestId('workspace-action-archive-note')).toBeVisible()
})

test('opens tablet table of contents without going through more actions', async ({ page }, info) => {
  test.skip(info.project.name === 'phone-portrait')
  await page.goto('/?source=fixture')
  await page.getByTestId('editor-table-of-contents-action').click()
  await expect(page.getByTestId('workspace-action-sheet-tableOfContents')).toBeVisible()
})
