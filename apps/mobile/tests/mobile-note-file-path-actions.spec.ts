import { expect, test } from '@playwright/test'

const mobileClipboardAttemptsGlobalKey = '__MEMORIA_MOBILE_CLIPBOARD_ATTEMPTS__'

test.describe('mobile note file path actions', () => {
  test('copies the selected note path from mobile more actions', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'File path overflow checks use the full-width tablet layout.')

    await page.goto('/')
    await page.getByTestId('editor-more-action').click()
    await page.getByTestId('workspace-action-group-file').click()
    await expect(page.getByText('Copy file path')).toBeVisible()
    await page.getByTestId('workspace-action-copy-file-path').click()

    await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
    await expect(page.evaluate((key) => {
      const attempts = (window as unknown as Record<string, unknown>)[key]
      return Array.isArray(attempts) ? attempts.at(-1) : null
    }, mobileClipboardAttemptsGlobalKey)).resolves.toBe(
      'Memoria/Mobile UI/Workflow Orchestration Essay.md',
    )
  })
})
