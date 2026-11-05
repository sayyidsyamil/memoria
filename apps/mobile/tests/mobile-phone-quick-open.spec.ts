import { expect, test } from '@playwright/test'

test('@smoke phone search opens the selected note in the editor', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-portrait')
  await page.goto('/?source=fixture&phoneState=list')
  await page.getByTestId('note-list-search-action').click()
  await page.getByTestId('workspace-search-input').fill('Workflow Orchestration')
  await page.getByTestId('workspace-search-results').getByRole('button').first().click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId('phone-editor-screen')).toBeVisible()
  await expect(page.getByTestId('editor-toolbar-title')).toHaveText('Workflow Orchestration Essay.md')
})
