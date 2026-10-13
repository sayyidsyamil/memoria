import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('memoria:ai-agents-onboarding-dismissed', '1')
    localStorage.setItem('memoria:claude-code-onboarding-dismissed', '1')
    localStorage.setItem('memoria:mock-ledger', 'fresh')
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Decisions', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

const ledger = (page: Page) => page.getByRole('dialog')
const openTab = (page: Page, name: string | RegExp) => ledger(page).getByRole('tab', { name }).click()

async function loadSampleSetup(page: Page) {
  await openTab(page, 'Setup')
  await ledger(page).getByRole('button', { name: 'Load sample setup' }).click()
  await expect(ledger(page).getByText('Sample setup loaded.')).toBeVisible()
}

async function addTheThreeMeetings(page: Page) {
  await openTab(page, 'Meetings')
  for (const title of ['Steering 1 - Kick-off', 'Steering 2 - Vendor and budget', 'Steering 3 - Timeline']) {
    await ledger(page).getByRole('button', { name: `Add ${title}` }).click()
    await expect(ledger(page).getByRole('button', { name: `Add ${title}` })).toHaveCount(0)
  }
  await expect(ledger(page).getByRole('region', { name: 'Meetings in the ledger' })).toContainText('Steering 3 - Timeline')
}

async function setUpEverything(page: Page) {
  await loadSampleSetup(page)
  await addTheThreeMeetings(page)
  await openTab(page, 'Now')
}

test('T1 set up the ledger and add the three meetings', async ({ page }) => {
  await expect(ledger(page).getByText('Nothing is tracked yet')).toBeVisible()
  await loadSampleSetup(page)
  await addTheThreeMeetings(page)
  await openTab(page, 'Now')
  await expect(ledger(page).getByRole('button', { name: /^Evidence: Go-live/ })).toBeVisible()
  await expect(ledger(page).getByRole('button', { name: /^Evidence: Pilot budget/ })).toBeVisible()
})

test('T2 find the decisions of meeting 2 and open the evidence', async ({ page }) => {
  await setUpEverything(page)
  await expect(ledger(page).getByText('Beta Cloud').first()).toBeVisible()
  await ledger(page).getByRole('button', { name: /^Evidence: Vendor/ }).click()
  const evidence = page.getByRole('dialog').filter({ hasText: 'Evidence:' })
  await expect(evidence.getByRole('heading', { name: /Evidence: Vendor/ })).toBeVisible()
  await expect(evidence).toContainText('Steering 2 - Vendor and budget')
  await expect(evidence.getByText(/Beta Cloud/).first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(evidence).toHaveCount(0)
})

test('T3 fix a value with a reason and see it saved', async ({ page }) => {
  await setUpEverything(page)
  await ledger(page).getByRole('button', { name: /^Fix: Go-live/ }).click()
  const fix = page.getByRole('dialog').filter({ hasText: 'Fix:' })
  const save = fix.getByRole('button', { name: 'Save correction' })
  await fix.getByLabel('Correct value').fill('2026-12-20')
  await expect(save).toBeDisabled()
  await fix.getByLabel(/Why are you changing it/).fill('The chair said 20 December.')
  await save.click()
  await expect(page.getByText(/Saved: Go-live .* corrected\./)).toBeVisible()
  await expect(ledger(page).getByText(/20 Dec/).first()).toBeVisible()
})

test('T4 ask the three example questions and see the evidence', async ({ page }) => {
  await setUpEverything(page)
  await openTab(page, 'Ask')
  const answer = ledger(page).getByRole('region', { name: 'Answer' })
  const cases: Array<[string, RegExp]> = [
    ['What is the current go-live date?', /go-live date is .*Dec/i],
    ['What was the budget on 20 September?', /On .*20 Sep.*was .*250,?000/i],
    ['How many times did the go-live date change?', /changed 2 times/i],
  ]
  for (const [question, expected] of cases) {
    await ledger(page).getByRole('button', { name: question }).click()
    await expect(answer).toContainText(expected)
    await expect(answer.getByText('Evidence', { exact: true })).toBeVisible()
    await expect(answer.locator('blockquote').first()).toBeVisible()
  }
})

test('T5 prepare shows open commitments and recent changes and copies markdown', async ({ page }) => {
  await setUpEverything(page)
  await openTab(page, 'Prepare')
  await expect(ledger(page).getByRole('heading', { name: /open commitments/i })).toBeVisible()
  await expect(ledger(page).getByRole('heading', { name: /changed recently|recent changes/i })).toBeVisible()
  await ledger(page).getByRole('button', { name: 'Copy as markdown' }).click()
  await expect(page.getByText('Brief copied. Paste it anywhere.')).toBeVisible()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toMatch(/^#/m)
  expect(copied).toMatch(/Go-live/i)
})

test('E1 a stale suggestion shows a plain message and can be dismissed', async ({ page }) => {
  await setUpEverything(page)
  await page.evaluate(() => {
    const handlers = (window as unknown as { __mockHandlers: Record<string, (args: { method: string }) => unknown> }).__mockHandlers
    const original = handlers.ledger_call
    handlers.ledger_call = (args) => {
      if (args.method === 'proposals.accept') throw '[StaleProposal] proposal 1 was made against a belief that has since changed'
      return original(args)
    }
  })
  await openTab(page, /To review/)
  const card = ledger(page).getByLabel(/^Suggestion:/).first()
  await card.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(card.getByText('This suggestion is out of date because something newer was recorded. It has been refreshed.')).toBeVisible()
  await expect(card).not.toContainText(/StaleProposal|Error/)
  await card.getByRole('button', { name: 'Dismiss' }).click()
  await expect(ledger(page).getByText(/^Dismissed: /)).toBeVisible()
})
