import type { Locator, Page } from '@playwright/test'

export async function longPressTestId(page: Page, testId: string) {
  await longPressLocator(page, page.getByTestId(testId), testId)
}

export async function longPressMouseTestId(page: Page, testId: string) {
  await longPressLocatorWithMouse(page, page.getByTestId(testId), testId)
}

export async function longPressRoleButton(page: Page, name: string) {
  await longPressLocatorWithMouse(page, page.getByRole('button', { name }).first(), name)
}

async function longPressLocator(page: Page, target: Locator, label: string) {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) throw new Error(`Cannot long-press missing target: ${label}`)

  const client = await page.context().newCDPSession(page)
  await client.send('Input.dispatchTouchEvent', {
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
    type: 'touchStart',
  })
  await page.waitForTimeout(700)
  await client.send('Input.dispatchTouchEvent', {
    touchPoints: [],
    type: 'touchEnd',
  })
  await client.detach()
}

async function longPressLocatorWithMouse(page: Page, target: Locator, label: string) {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) throw new Error(`Cannot long-press missing target: ${label}`)

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(700)
  await page.mouse.up()
}
