import { expect, test } from '@playwright/test'

test.describe('mobile note neighborhood actions', () => {
  test('opens the selected note neighborhood from mobile more actions', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Neighborhood overflow checks use the full-width tablet layout.')

    await page.goto('/?scenario=markdown-heavy')
    await page.getByTestId('note-row-workflow-orchestration').click()
    await expect(page.getByTestId('editor-toolbar-title')).toHaveText('Workflow Orchestration Essay.md')

    await page.getByTestId('editor-more-action').click()
    await expect(page.getByText("Open note's neighborhood")).toBeVisible()
    await page.getByTestId('workspace-action-open-neighborhood').click()

    await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
    await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Workflow Orchestration Essay')
    await expect(page.getByTestId('relationship-group-referenced-by')).toBeVisible()
    await expect(page.getByTestId('note-row-markdown-heavy-renderer')).toBeVisible()
  })
})
