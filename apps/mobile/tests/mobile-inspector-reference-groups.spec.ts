import { expect, test } from '@playwright/test'

test.describe('mobile inspector reference groups', () => {
  test('shows desktop inspector reference groups', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Inspector reference groups use the full-width tablet layout.')

    await page.goto('/?scenario=markdown-heavy')
    await page.getByTestId('note-row-workflow-orchestration').click()
    await expect(page.getByTestId('inspector-reference-group-referenced-by')).toContainText('Referenced by')
    await expect(page.getByTestId('inspector-reference-row-markdown-renderer-parity')).toBeVisible()
    await page.getByTestId('inspector-reference-row-markdown-renderer-parity').click()
    await expect(page.getByTestId('editor-toolbar-title')).toHaveText('Markdown Renderer Parity.md')
  })
})
