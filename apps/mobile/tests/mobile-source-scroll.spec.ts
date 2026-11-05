import { expect, test } from '@playwright/test'

test('source syntax follows scrolling without truncating the document', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/?source=fixture&editorMode=source&phoneState=editor')
  const input = page.getByTestId('editor-markdown-input')
  const syntax = page.getByTestId('editor-markdown-syntax')
  await input.fill(Array.from({ length: 70 }, (_, index) => `Source line ${index + 1}`).join('\n'))
  await input.hover()
  await page.mouse.wheel(0, 600)
  await expect.poll(() => input.evaluate(element => element.scrollTop)).toBeGreaterThan(100)
  await expect.poll(async () => {
    const scrollY = await input.evaluate(element => element.scrollTop)
    const syntaxY = await syntax.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42)
    return Math.abs(scrollY + syntaxY)
  }).toBeLessThan(1)
  const height = await syntax.evaluate(element => element.scrollHeight)
  expect(height).toBeGreaterThan(await input.evaluate(element => element.clientHeight * 2))
  await expect(input).toHaveValue(/Source line 70$/)
  expect(errors).toEqual([])
})
