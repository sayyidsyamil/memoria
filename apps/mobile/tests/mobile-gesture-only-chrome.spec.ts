import { expect, test } from '@playwright/test'
import { openPhoneProperties, openPhoneSidebar, phoneBack, toggleTabletProperties } from './mobile-panel-navigation'

test('panel navigation has no redundant toolbar buttons', async ({ page }, info) => {
  const phone = info.project.name === 'phone-portrait'
  await page.goto(phone ? '/?phoneState=list' : '/?tabletPanels=all')
  await expect(page.getByTestId('note-list-toolbar')).toBeVisible()
  for (const id of ['phone-sidebar-action', 'tablet-note-list-sidebar-action', 'tablet-editor-chrome-toggle']) {
    await expect(page.getByTestId(id)).toHaveCount(0)
  }
  if (phone) {
    await openPhoneSidebar(page)
    await page.getByTestId('sidebar-item-all-notes').click()
    await page.getByTestId('note-row-workflow-orchestration').click()
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(page.viewportSize()?.width)
    await expect(page.getByTestId('editor-toolbar').getByTestId('phone-back-action')).toHaveCount(0)
    await expect(page.getByTestId('phone-properties-action')).toHaveCount(0)
    await openPhoneProperties(page)
    await phoneBack(page)
    await phoneBack(page)
  } else {
    await expect(page.getByTestId('editor-properties-action')).toHaveCount(0)
    await toggleTabletProperties(page)
    await toggleTabletProperties(page)
  }
})
