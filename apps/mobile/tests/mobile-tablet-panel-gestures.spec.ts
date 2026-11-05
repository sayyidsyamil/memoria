import { expect, test, type Page } from '@playwright/test'
import { dragPanel, toggleTabletProperties } from './mobile-panel-navigation'

test.describe('tablet panel gestures', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-landscape', 'Panel gestures use the full-width tablet layout.')
    await page.goto('/?tabletPanels=all')
  })

  test('directly drags both left panels away in one gesture', async ({ page }) => {
    await toggleTabletProperties(page)
    await expectPropertiesVisible(page, false)

    const noteList = await requiredBox(page, 'note-list-toolbar')
    await dragPanel(
      page,
      { x: noteList.x + noteList.width - 90, y: noteList.y + noteList.height / 2 },
      { x: 12, y: noteList.y + noteList.height / 2 },
    )
    await page.waitForTimeout(500)

    const leftPanels = await requiredBox(page, 'tablet-left-panel-strip')
    const editor = await requiredBox(page, 'editor-panel')
    expect(leftPanels.x + leftPanels.width).toBeLessThanOrEqual(1)
    expect(editor.x).toBeLessThanOrEqual(1)
  })

  test('reveals and hides Properties with a drag, without a toolbar toggle', async ({ page }) => {
    await expect(page.getByTestId('editor-properties-action')).toHaveCount(0)
    await toggleTabletProperties(page)
    await expectPropertiesVisible(page, false)
    await toggleTabletProperties(page)
    await expectPropertiesVisible(page, true)
  })
})

async function requiredBox(page: Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox()
  if (!box) throw new Error(`Cannot measure missing ${testId}.`)
  return box
}

async function expectPropertiesVisible(page: Page, visible: boolean) {
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('Cannot measure the mobile QA viewport.')
  const panel = await requiredBox(page, 'tablet-properties-panel-host')
  if (visible) expect(panel.x).toBeLessThanOrEqual(viewport.width - panel.width + 1)
  else expect(panel.x).toBeGreaterThan(viewport.width - panel.width + 1)
}
