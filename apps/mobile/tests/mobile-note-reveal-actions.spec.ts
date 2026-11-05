import { expect, test } from '@playwright/test'

test.describe('mobile note reveal actions', () => {
  test('does not expose reveal-in-Finder from mobile more actions', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'File action checks use the full-width tablet layout.')

    await page.goto('/')
    await page.getByTestId('editor-more-action').click()
    await page.getByTestId('workspace-action-group-file').click()
    await expect(page.getByText('Reveal in Finder')).toHaveCount(0)
    await expect(page.getByTestId('workspace-action-reveal-file')).toHaveCount(0)
  })
})
