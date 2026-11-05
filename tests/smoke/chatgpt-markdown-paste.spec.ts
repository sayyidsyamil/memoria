import { expect, test, type Page } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette } from './helpers'

let tempVaultDir: string

const longBoldText = `**${'Markdown source '.repeat(6).trim()}**`
const chatGptMarkdown = [
  '# ChatGPT Markdown',
  'Paragraph immediately follows the heading.',
  '',
  '- One list item',
  '',
  longBoldText,
].join('\n')

async function pasteChatGptClipboard(page: Page): Promise<void> {
  await page.locator('.bn-editor [data-content-type="paragraph"]').last().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')

  await page.locator('.bn-editor').evaluate((editor, markdown) => {
    const target = editor.querySelector('[data-content-type="paragraph"]:last-of-type') ?? editor
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/html', '<p>Flattened HTML fallback</p>')
    clipboardData.setData('text/plain', markdown)
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: clipboardData })
    target.dispatchEvent(event)
  }, chatGptMarkdown)
}

async function readRawMarkdown(page: Page): Promise<string> {
  await openCommandPalette(page)
  await executeCommand(page, 'Toggle Raw')
  const rawEditor = page.getByTestId('raw-editor-codemirror')
  await expect(rawEditor).toBeVisible({ timeout: 5_000 })
  return rawEditor.innerText()
}

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVault(page, tempVaultDir)
  await page.locator('[data-testid="note-list-container"]')
    .getByText('Alpha Project', { exact: true })
    .click()
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
})

test.afterEach(async () => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('ChatGPT-style multi-MIME paste prefers Markdown source @smoke', async ({ page }) => {
  await pasteChatGptClipboard(page)

  await expect(page.locator('.bn-editor h1', { hasText: 'ChatGPT Markdown' })).toBeVisible()
  await expect(page.locator('.bn-editor [data-content-type="bulletListItem"]', {
    hasText: 'One list item',
  })).toBeVisible()
  const savedMarkdown = await readRawMarkdown(page)
  expect(savedMarkdown).toContain('# ChatGPT Markdown')
  expect(savedMarkdown).toContain('- One list item')
  expect(savedMarkdown).toContain(longBoldText)
  expect(savedMarkdown).not.toContain('Flattened HTML fallback')
})
