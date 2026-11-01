import { describe, expect, it } from 'vitest'
import { redactWebUrl, scrubWebBreadcrumb } from './webSentry'

describe('redactWebUrl', () => {
  it.each([
    ['https://memoria.example/v1/files/Projects/Plan.md', 'https://memoria.example/v1'],
    ['https://memoria.example/collab?ticket=secret#x', 'https://memoria.example/collab'],
    ['https://memoria.example/', 'https://memoria.example'],
    ['/v1/entries?since=1', `${window.location.origin}/v1`],
  ])('cuts %s down to %s', (input, expected) => {
    expect(redactWebUrl(input)).toBe(expected)
  })

  it('drops values that are not URLs', () => {
    expect(redactWebUrl('http://[broken')).toBe('')
  })
})

describe('scrubWebBreadcrumb', () => {
  it('redacts request and navigation URLs and keeps the rest', () => {
    expect(scrubWebBreadcrumb({
      category: 'navigation',
      data: { from: '/n/Journal/2026-10-25.md', to: '/n/Private/Note.md', status_code: 200 },
    })).toEqual({
      category: 'navigation',
      data: { from: `${window.location.origin}/n`, to: `${window.location.origin}/n`, status_code: 200 },
    })
  })

  it('leaves breadcrumbs without data alone', () => {
    const breadcrumb = { category: 'console', message: 'hello' }
    expect(scrubWebBreadcrumb(breadcrumb)).toBe(breadcrumb)
  })
})
