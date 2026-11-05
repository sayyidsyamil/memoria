import { afterEach, expect, it, vi } from 'vitest'
import { mobileMarkdownBodyToTentapHtml } from './mobileDocumentContent'

afterEach(() => { vi.unstubAllGlobals() })

it('rejects executable schemes even when the host URL constructor treats them as relative', () => {
  vi.stubGlobal('URL', class { protocol = 'https:' })
  expect(mobileMarkdownBodyToTentapHtml('- [unsafe](javascript:alert(1))')).not.toContain('href=')
})

it('preserves relative and mail links without a WHATWG URL constructor', () => {
  vi.stubGlobal('URL', undefined)
  expect(mobileMarkdownBodyToTentapHtml('- [file](attachments/note.pdf)')).toContain('href="attachments/note.pdf"')
  expect(mobileMarkdownBodyToTentapHtml('- [mail](mailto:notes@example.com)')).toContain('href="mailto:notes@example.com"')
})

it.each([
  '- <img src=x onerror=alert(1)>',
  '- [ ] <script>alert(1)</script>',
  '1. <svg onload=alert(1)>',
  '- [unsafe](javascript:alert(1))',
  '- [unsafe](JaVaScRiPt:alert(1))',
  '- [unsafe](\u0000javascript:alert(1))',
  '- [unsafe](<java\tscript:alert(1)>)',
  '- [unsafe](data:text/html;base64,PHNjcmlwdD4=)',
])('escapes or rejects executable list content: %s', (markdown) => {
  const html = mobileMarkdownBodyToTentapHtml(markdown)
  expect(html).toContain('<li')
  expect(html).not.toMatch(/<(?:script|img|iframe|svg)\b/i)
  expect(html).not.toMatch(/(?:src|href)\s*=\s*["'](?:javascript|data):/i)
  expect(html).not.toContain('href="java\tscript:')
})

it.each([
  'https://example.com/readme', 'mailto:notes@example.com', 'tel:+123456',
  'attachments/note.pdf', '#section', 'memoria://wikilink/Note',
])('preserves a supported link target %s', (href) => {
  expect(mobileMarkdownBodyToTentapHtml(`- [safe](${href})`)).toContain(`href="${href}"`)
})
