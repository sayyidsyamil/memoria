import { openPhoneSidebar, phoneBack } from './mobile-panel-navigation'
import { expect, test, type Page } from '@playwright/test'
import { longPressMouseTestId } from './mobile-phone-test-gestures'

test.describe('phone favorite action parity', () => {
  test('reorders favorite rows from the phone sidebar', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-portrait', 'Phone favorite actions run on the phone sidebar.')

    await page.goto('/')
    await addOpenSourceProjectToFavorites(page)
    await openPhoneSidebar(page)
    await expectFavoriteBefore(page, 'open-source-project', 'workflow-orchestration')

    await longPressMouseTestId(page, 'sidebar-item-favorite-open-source-project')
    await expect(page.getByTestId('workspace-action-sheet-editFavorite')).toBeVisible()
    await page.getByTestId('workspace-move-favorite-down-action').click()

    await expectFavoriteBefore(page, 'workflow-orchestration', 'open-source-project')
  })
})

async function addOpenSourceProjectToFavorites(page: Page) {
  await openPhoneSidebar(page)
  await page.getByTestId('sidebar-item-all-notes').click()
  await page.getByTestId('note-row-open-source-project').click()
  await expect(page.getByTestId('phone-editor-screen')).toBeVisible()
  await page.getByTestId('editor-favorite-action').click()
  await expect(page.getByTestId('editor-favorite-action')).toHaveAccessibleName('Remove from Favorites')
  await phoneBack(page)
}

async function expectFavoriteBefore(page: Page, firstNoteId: string, secondNoteId: string) {
  const firstBox = await page.getByTestId(`sidebar-item-favorite-${firstNoteId}`).boundingBox()
  const secondBox = await page.getByTestId(`sidebar-item-favorite-${secondNoteId}`).boundingBox()
  if (!firstBox || !secondBox) throw new Error('Cannot measure favorite sidebar rows.')

  expect(firstBox.y).toBeLessThan(secondBox.y)
}
