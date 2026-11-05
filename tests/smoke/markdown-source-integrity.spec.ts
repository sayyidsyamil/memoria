import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVaultDesktopHarness, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette } from './helpers'

const source = '# Integrity Save\n\nInline code: `loadData([["y"]])` and `[[x]]`.\nPlaceholder: <term>\n<!-- comment -->\nEntity: &lt;term&gt;\n\n| id | left | right |\n| :--- | :--- | ---: |\n| a | b | c |\n'

test('@smoke rich and raw saves preserve untouched Markdown source', async ({ page }) => {
  const vault = createFixtureVaultCopy()
  const file = path.join(vault, 'note', 'integrity-save.md')
  fs.writeFileSync(file, source)
  try {
    await openFixtureVaultDesktopHarness(page, vault)
    await page.getByTestId('note-list-container').getByText('Integrity Save', { exact: true }).click()
    const paragraph = page.locator('.bn-block-content').filter({ hasText: 'Inline code:' }).first()
    await expect(paragraph).toBeVisible()
    await paragraph.click({ position: { x: 20, y: 10 } })
    await page.keyboard.press('Home')
    await page.keyboard.type('X')
    await page.keyboard.press('Control+s')
    const richSaved = source.replace('Inline code:', 'XInline code:')
    await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe(richSaved)
    await openCommandPalette(page)
    await executeCommand(page, 'Toggle Raw')
    const raw = page.locator('.cm-content')
    await expect(raw).toBeVisible()
    await expect(raw).toContainText('&lt;term&gt;')
    await raw.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('R')
    await page.keyboard.press('Control+s')
    await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe(`${richSaved}R`)
  } finally {
    removeFixtureVaultCopy(vault)
  }
})
