import { openPhoneSidebar } from './mobile-panel-navigation'
import { expect, test, type Page } from '@playwright/test'
import { longPressRoleButton } from './mobile-phone-test-gestures'

test.describe('phone folder action parity', () => {
  test('creates, renames, nests, and deletes folders from the phone sidebar', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-portrait', 'Phone folder actions run through the phone sidebar drawer.')

    await page.goto('/')
    await openPhoneSidebar(page)
    await page.getByTestId('sidebar-section-create-folders').click()
    await expect(page.getByTestId('workspace-create-folder-name-input')).toBeVisible()
    await page.getByTestId('workspace-create-folder-name-input').fill('Phone Test Folder')
    await page.getByTestId('workspace-action-sheet-createFolder').getByRole('button', { exact: true, name: 'Create' }).click()
    await expect(page.getByRole('button', { name: 'Phone Test Folder' })).toBeVisible()
    await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Phone Test Folder')

    await longPressRoleButton(page, 'Phone Test Folder')
    await expect(page.getByTestId('workspace-rename-folder-input')).toHaveValue('Phone Test Folder')
    await page.getByTestId('workspace-rename-folder-input').fill('Phone Renamed Folder')
    await page.getByTestId('workspace-action-sheet-editFolder').getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('button', { name: 'Phone Renamed Folder' })).toBeVisible()
    await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Phone Renamed Folder')

    await longPressRoleButton(page, 'Phone Renamed Folder')
    await page.getByTestId('workspace-action-copy-folder-path').click()
    await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
    await expect(latestClipboardAttempt(page)).resolves.toBe('Phone Renamed Folder')

    await longPressRoleButton(page, 'Phone Renamed Folder')
    await page.getByTestId('workspace-action-create-note-in-folder').click()
    await expect(page.getByTestId('workspace-action-sheet')).toBeHidden()
    await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Phone Renamed Folder')
    await expect(page.getByTestId(/note-row-Phone Renamed Folder\/untitled-note-\d+\.md/u)).toBeVisible()

    await longPressRoleButton(page, 'Phone Renamed Folder')
    await page.getByTestId('workspace-action-create-child-folder').click()
    await page.getByTestId('workspace-create-folder-name-input').fill('Phone Child Folder')
    await page.getByTestId('workspace-action-sheet-createFolder').getByRole('button', { exact: true, name: 'Create' }).click()
    await expect(page.getByRole('button', { name: 'Phone Child Folder' })).toBeVisible()
    await expect(page.getByTestId('note-list-toolbar-title')).toHaveText('Phone Child Folder')

    await deletePhoneFolder(page, 'Phone Child Folder')
    await deletePhoneFolder(page, 'Phone Renamed Folder')
  })
})

async function deletePhoneFolder(page: Page, folderName: string) {
  await longPressRoleButton(page, folderName)
  await page.getByTestId('workspace-action-delete-folder').click()
  await expect(page.getByRole('button', { name: folderName })).toBeHidden()
}

async function latestClipboardAttempt(page: Page) {
  return page.evaluate(() => {
    const attempts = (window as unknown as Record<string, unknown>).__MEMORIA_MOBILE_CLIPBOARD_ATTEMPTS__
    return Array.isArray(attempts) ? attempts.at(-1) : null
  })
}
