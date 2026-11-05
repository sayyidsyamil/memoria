import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test.describe('mobile editor find and replace', () => {
  test('replaces current note content from mobile more actions', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Find/replace checks use the full-width tablet layout.')

    await page.goto('/')
    await replaceLowerPriorityWithQuiet(page)
  })

  test('reuses the same replace flow from the phone editor more actions', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-portrait', 'Phone find/replace checks run on the phone editor shell.')

    await page.goto('/?phoneState=editor')
    await expect(page.getByTestId('phone-editor-screen')).toBeVisible()
    await replaceLowerPriorityWithQuiet(page)
  })
})

async function replaceLowerPriorityWithQuiet(page: Page) {
  await openMoreActions(page)
  await page.getByTestId('workspace-action-replace-in-note').click()
  await expect(page.getByTestId('editor-inline-find')).toBeVisible()
  await page.getByTestId('workspace-find-input').fill('lower-priority')
  await expect(page.getByTestId('workspace-find-count')).toHaveText('1 / 1')
  await page.getByTestId('workspace-replace-input').fill('quiet')
  await page.getByTestId('workspace-replace-current').click()
  await expect(page.getByTestId('workspace-find-count')).toHaveText('No matches')
  await page.getByTestId('workspace-find-close').click()
  await expect(page.getByTestId('editor-inline-find')).toBeHidden()
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/dates, and quiet chrome\./u)
  await expect(page.getByTestId('editor-markdown-input')).not.toHaveValue(/dates, and lower-priority chrome\./u)
  await undoAndRedoLastEditorChange(page)
}

async function undoAndRedoLastEditorChange(page: Page) {
  await openMoreActions(page)
  await page.getByTestId('workspace-action-undo-edit').click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/dates, and lower-priority chrome\./u)
  await expect(page.getByTestId('editor-markdown-input')).not.toHaveValue(/dates, and quiet chrome\./u)

  await openMoreActions(page)
  await page.getByTestId('workspace-action-redo-edit').click()
  await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
  await expect(page.getByTestId('editor-markdown-input')).toHaveValue(/dates, and quiet chrome\./u)
  await expect(page.getByTestId('editor-markdown-input')).not.toHaveValue(/dates, and lower-priority chrome\./u)
}

async function openMoreActions(page: Page) {
  await expect(page.getByTestId('workspace-action-sheet')).toHaveCount(0)
  await page.getByTestId('editor-more-action').click()
  await expect(page.getByTestId('workspace-action-sheet-moreActions')).toBeVisible()
  await page.getByTestId('workspace-action-group-edit').click()
}
