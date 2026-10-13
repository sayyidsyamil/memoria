import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('memoria:ai-agents-onboarding-dismissed', '1')
    localStorage.setItem('memoria:claude-code-onboarding-dismissed', '1')
    localStorage.setItem('memoria:mock-ledger', 'demo')
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Decisions', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('E2 a misread number is flagged, pre-filled from the quote and recorded after the check', async ({ page }) => {
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: /To review/ }).click()
  const card = dialog.getByLabel('Suggestion: Pilot budget (RM) · Amount')
  await expect(card.getByText('The number 2,500,000 does not appear in the quote. Please check it.')).toBeVisible()
  await expect(card.getByText(/250,000 ringgit/)).toBeVisible()
  await expect(card.getByRole('button', { name: 'Accept', exact: true })).toBeEnabled()
  await card.getByRole('button', { name: 'Edit then accept' }).click()
  await expect(card.getByLabel('Value to record')).toHaveValue('250000')
  await card.getByRole('button', { name: 'Save and accept' }).click()
  await expect(page.getByText('Recorded: Pilot budget (RM) · Amount.')).toBeVisible()
  await dialog.getByRole('tab', { name: 'Now' }).click()
  await expect(dialog.getByText('250,000', { exact: true })).toBeVisible()
})
