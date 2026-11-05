import { expect, test, type Locator } from '@playwright/test'
import { openPhoneSidebar } from './mobile-panel-navigation'

async function bounds(target: Locator) {
  await expect(target).toBeVisible()
  const box = await target.boundingBox()
  if (!box) throw new Error('Footer control has no layout bounds')
  return box
}

for (const colorScheme of ['light', 'dark'] as const) {
  for (const bottom of [0, 21, 34]) {
    test(`pane footer rows center with ${bottom}pt inset in ${colorScheme} mode`, async ({ page }, info) => {
      const phone = info.project.name === 'phone-portrait'
      const session = await page.context().newCDPSession(page)
      await session.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 0, right: 0, bottom } })
      await page.emulateMedia({ colorScheme })
      await page.goto('/?source=fixture&phoneState=sidebar&tabletPanels=all&editorMode=source')
      await page.getByTestId('sidebar-item-essays').click()
      const list = await bounds(page.getByTestId('note-list-filter-pills'))
      const filter = await bounds(page.getByTestId('filter-pill-open'))
      if (phone) await page.getByTestId('note-row-workflow-orchestration').click()
      const editor = await bounds(page.getByTestId('editor-formatting-toolbar'))
      const bold = await bounds(page.getByTestId('editor-format-bold'))
      if (phone) {
        await page.goto('/?source=fixture&phoneState=sidebar')
        await openPhoneSidebar(page)
      }
      const sidebar = await bounds(page.getByTestId('sidebar-settings'))
      const command = await bounds(page.getByTestId('sidebar-command-palette-action'))
      const settings = await bounds(page.getByTestId('open-mobile-settings'))
      for (const row of [list, editor, sidebar]) expect(row.height).toBe(48 + bottom)
      for (const row of [editor, sidebar]) expect(Math.abs(row.y - list.y)).toBeLessThan(1)
      const center = filter.y + filter.height / 2
      expect(Math.abs(center - (list.y + list.height / 2))).toBeLessThan(1)
      for (const control of [bold, command, settings]) {
        expect(Math.abs(control.y + control.height / 2 - center)).toBeLessThan(1)
        expect(control.height).toBeGreaterThanOrEqual(44)
      }
      await expect(page.getByTestId('sidebar-settings')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    })
  }
}
