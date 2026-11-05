import { expect, type Page } from '@playwright/test'

export async function createTitledNoteFromQuickOpen(
  page: Page,
  title: string,
  rowTestId = `note-row-${noteRowSlug(title)}.md`,
) {
  await page.getByTestId('note-list-search-action').click()
  await expect(page.getByTestId('workspace-action-sheet-search')).toBeVisible()
  await page.getByTestId('workspace-search-input').fill(title)
  await page.getByTestId('workspace-search-create-note').click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId(rowTestId)).toBeVisible()
}

export function noteRowSlug(title: string) {
  return title.trim().toLowerCase().replace(/\s+/gu, '-')
}
