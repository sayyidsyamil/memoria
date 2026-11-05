import { expect, type Page } from '@playwright/test'

export async function swipePanel(page: Page, direction: 'left' | 'right') {
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('Panel navigation requires a viewport.')
  const startX = direction === 'right' ? 12 : viewport.width - 12
  const endX = direction === 'right' ? viewport.width * 0.8 : viewport.width * 0.2
  await dragPanel(page, { x: startX, y: 220 }, { x: endX, y: 220 })
}

export async function dragPanel(page: Page, start: { x: number; y: number }, end: { x: number; y: number }) {
  const client = await page.context().newCDPSession(page)
  try {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
    for (let step = 1; step <= 12; step += 1) {
      const point = { x: start.x + (end.x - start.x) * step / 12, y: start.y + (end.y - start.y) * step / 12 }
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] })
      await page.waitForTimeout(30)
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await client.detach()
  }
}

export async function openPhoneSidebar(page: Page) {
  if (await phonePanelIsOpen(page, 'phone-sidebar-screen')) return
  await swipePanel(page, 'right')
  await expect(page.getByTestId('sidebar-item-inbox')).toBeInViewport({ ratio: 1 })
}

export async function closePhoneSidebar(page: Page) {
  await swipePanel(page, 'left')
  await expect(page.getByTestId('note-list-toolbar-title')).toBeInViewport({ ratio: 1 })
}

export async function openPhoneProperties(page: Page) {
  await expect(page.getByTestId('editor-toolbar-title')).toBeInViewport({ ratio: 1 })
  await swipePanel(page, 'left')
  await expect(page.getByTestId('phone-properties-screen')).toBeInViewport({ ratio: 1 })
}

export async function phoneBack(page: Page) {
  const fromProperties = await phonePanelIsOpen(page, 'phone-properties-screen')
  await swipePanel(page, 'right')
  const destination = fromProperties ? 'editor-toolbar-title' : 'note-list-toolbar-title'
  await expect(page.getByTestId(destination)).toBeInViewport({ ratio: 1 })
}

async function phonePanelIsOpen(page: Page, testID: string) {
  const screen = page.getByTestId(testID)
  const first = await screen.boundingBox()
  await page.waitForTimeout(220)
  const second = await screen.boundingBox()
  return Boolean(first && second && first.x >= 0 && first.x <= 16 && Math.abs(first.x - second.x) < 1)
}

export async function toggleTabletProperties(page: Page) {
  const panel = page.getByTestId('tablet-properties-panel-host')
  const box = await panel.boundingBox()
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('Panel navigation requires a viewport.')
  const visible = Boolean(box && box.x <= viewport.width - box.width + 1)
  if (visible && box) {
    await hideTabletProperties(page, box.x, viewport.width)
  } else {
    await dragPanel(page, { x: viewport.width - 12, y: 220 }, { x: viewport.width - 280, y: 220 })
  }
  await expect.poll(async () => {
    const bounds = await page.getByTestId('tablet-properties-panel-host').boundingBox()
    if (!bounds) return false
    return visible
      ? bounds.x > viewport.width - bounds.width + 1
      : bounds.x <= viewport.width - bounds.width + 1
  }).toBe(true)
}

async function hideTabletProperties(page: Page, left: number, width: number) {
  const toolbar = await page.getByTestId('properties-toolbar').boundingBox()
  if (!toolbar) throw new Error('Properties toolbar is unavailable.')
  const y = toolbar.y + toolbar.height / 2
  await dragPanel(page, { x: left + 12, y }, { x: width - 12, y })
}
