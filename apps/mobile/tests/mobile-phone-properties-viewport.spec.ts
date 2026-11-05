import { expect, test } from '@playwright/test'

test('properties fit below the phone header and expose bottom actions', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone-portrait', 'Checks the single-screen phone layout.')
  await page.goto('/?phoneState=properties')
  const panel = page.getByTestId('properties-panel')
  await expect(panel).toBeVisible()
  const screen = await page.getByTestId('phone-properties-screen').boundingBox()
  const bounds = await panel.boundingBox()
  if (!screen || !bounds) throw new Error('Properties viewport is missing.')
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(screen.y + screen.height + 1)
  const action = page.getByTestId('property-action-add-relationship')
  await action.scrollIntoViewIfNeeded()
  await expect(action).toBeInViewport({ ratio: 1 })
  await action.click()
  await expect(page.getByTestId('workspace-relationship-name-input')).toBeVisible()
})
