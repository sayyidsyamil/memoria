import type { Page } from '@playwright/test'

export async function latestClipboardAttempt(page: Page) {
  return page.evaluate(() => {
    const attempts = Reflect.get(window, '__MEMORIA_MOBILE_CLIPBOARD_ATTEMPTS__')
    return Array.isArray(attempts) ? attempts.at(-1) ?? null : null
  })
}

export async function fileRevealAttempts(page: Page) {
  return page.evaluate(() => {
    const attempts = Reflect.get(window, '__MEMORIA_MOBILE_FILE_REVEAL_ATTEMPTS__')
    return Array.isArray(attempts) ? attempts : []
  })
}
