import { test, expect, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import type { TiptapJsonNode } from '../../apps/mobile/src/workspace/mobileDocumentContent.types'

const require = createRequire(import.meta.url)
const { mobileWysiwygTentapEditorHtml }: typeof import('../../apps/mobile/src/components/workspace/MobileWysiwygTentapEditorHtml') = require('../../apps/mobile/src/components/workspace/MobileWysiwygTentapEditorHtml')
const { mobileTentapEditorCss }: typeof import('../../apps/mobile/src/components/workspace/MobileWysiwygMarkdownEditorCss') = require('../../apps/mobile/src/components/workspace/MobileWysiwygMarkdownEditorCss')
const { mobileMarkdownBodyToTentapHtml, tiptapJsonToMobileMarkdown }: typeof import('../../apps/mobile/src/workspace/mobileDocumentContent') = require('../../apps/mobile/src/workspace/mobileDocumentContent')

type BridgeWindow = Window & { nativeProof: Array<{ type: string; payload: { content: TiptapJsonNode } }> }

async function openNativeDocument(page: Page, markdown: string) {
  const initial = mobileMarkdownBodyToTentapHtml(markdown)
  const configuration = JSON.stringify({ doc: {}, link: {}, heading: {} })
  const setup = `window.nativeProof=[];window.ReactNativeWebView={postMessage:message=>window.nativeProof.push(JSON.parse(message))};window.initialContent=${JSON.stringify(initial)};window.bridgeExtensionConfigMap=${JSON.stringify(configuration)};window.whiteListBridgeExtensions=['doc','link','heading'];window.editable=true;window.disableColorHighlight=true;window.contentInjected=true;`
  await page.goto('about:blank')
  await page.setContent(mobileWysiwygTentapEditorHtml.replace('<script>', `<script>${setup}</script><script>`))
  await page.addStyleTag({ content: mobileTentapEditorCss(true) })
  await expect(page.locator('.ProseMirror')).toBeVisible()
}

async function saveNativeDocument(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
    type: 'action', payload: { type: 'get-json', payload: { messageId: 'owned-wikilink-proof' } },
  }) })))
  await expect.poll(() => page.evaluate(() => (window as BridgeWindow).nativeProof.some(message => message.type === 'send-json-back'))).toBe(true)
  const document = await page.evaluate(() => (window as BridgeWindow).nativeProof.find(message => message.type === 'send-json-back')?.payload.content)
  if (!document) throw new Error('Native editor did not return its document')
  return tiptapJsonToMobileMarkdown(document)
}

test('native shipped editor preserves wikilink targets across note switching @smoke', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const original = 'See [[Projects/Launch|Launch plan]] and [[Another note]].'
  await openNativeDocument(page, original)
  const link = page.getByRole('link', { name: 'Launch plan' })
  await expect(link).toHaveAttribute('href', 'memoria://wikilink/Projects%2FLaunch')
  await expect(link).toHaveCSS('text-decoration-style', 'dotted')
  expect(await link.evaluate(element => getComputedStyle(element, '::before').maskImage)).toContain('data:image/svg+xml')
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' Saved edit.')
  const saved = await saveNativeDocument(page)
  expect(saved).toContain('[[Projects/Launch|Launch plan]]')
  expect(saved).toContain('Saved edit.')
  await openNativeDocument(page, '# Another note')
  await openNativeDocument(page, saved)
  await expect(page.getByRole('link', { name: 'Launch plan' })).toHaveAttribute('href', 'memoria://wikilink/Projects%2FLaunch')
  expect(await saveNativeDocument(page)).toBe(saved)
  expect(errors).toEqual([])
})
