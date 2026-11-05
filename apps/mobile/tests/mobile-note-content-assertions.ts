import { expect, type Page } from '@playwright/test'

export async function expectSourceContainsSnippet(page: Page, snippet: string) {
  await expect.poll(async () => containsSnippetWords(
    await page.getByTestId('editor-markdown-input').inputValue(), snippet,
  )).toBe(true)
}

function containsSnippetWords(content: string, snippet: string) {
  const words = (snippet.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 6)
  let remaining = content.toLowerCase()
  for (const word of words) {
    const offset = remaining.indexOf(word)
    if (offset < 0) return false
    remaining = remaining.slice(offset + word.length)
  }
  return true
}
