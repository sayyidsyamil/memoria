import { expect, test } from '@playwright/test'

test('local-folder import belongs to Available Vaults without a repeated sync overview', async ({ page }) => {
  await page.goto('/?source=fixture&phoneState=sidebar&tabletPanels=all')
  await page.getByTestId('open-mobile-settings').click()
  const settings = page.getByTestId('mobile-settings')
  await expect(settings).toBeVisible()
  await expect(settings.getByTestId('vault-sync-history')).toHaveCount(0)
  await expect(settings.getByTestId('saved-vaults').getByTestId('open-local-vault')).toBeVisible()
  await expect(settings.getByTestId('open-local-vault')).toHaveCount(1)
})

test('relationships have a padded divider below Add property', async ({ page }) => {
  await page.goto('/?source=fixture&phoneState=properties&tabletPanels=all')
  const group = page.getByTestId('properties-relationships-group')
  const addProperty = page.getByTestId('property-action-add-property')
  await expect(group).toBeVisible()
  await expect(group).toHaveCSS('border-top-style', 'solid')
  await expect(group).toHaveCSS('padding-top', '9.6px')
  const before = await addProperty.boundingBox()
  const after = await group.boundingBox()
  if (!before || !after) throw new Error('Missing properties section bounds')
  expect(after.y - before.y - before.height).toBeGreaterThanOrEqual(9)
})
