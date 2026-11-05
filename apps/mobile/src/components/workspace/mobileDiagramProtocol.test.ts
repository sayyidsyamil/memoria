import { expect, it } from 'vitest'
import { isDiagramRequest, isDiagramResponse } from './mobileDiagramProtocol'

it('accepts only bounded, typed requests with positive safe identifiers', () => {
  const request = { type: 'memoria-diagram-render', id: 1, kind: 'mermaid', content: 'graph TD; A-->B', dark: false }
  expect(isDiagramRequest(request)).toBe(true)
  for (const patch of [{ id: 0 }, { id: NaN }, { kind: 'html' }, { content: '' }, { dark: 'false' },
    { content: 'a'.repeat(8 * 1024 * 1024 + 1) }]) {
    expect(isDiagramRequest({ ...request, ...patch })).toBe(false)
  }
  expect(isDiagramRequest(null)).toBe(false)
})

it('rejects malformed or oversized renderer responses', () => {
  expect(isDiagramResponse({ type: 'memoria-diagram-result', id: 1, svg: '<svg/>' })).toBe(true)
  expect(isDiagramResponse({ type: 'memoria-diagram-result', id: 1, failed: true })).toBe(true)
  for (const response of [null, {}, { type: 'memoria-diagram-result', id: 1 },
    { type: 'memoria-diagram-result', id: 1, svg: 'a'.repeat(16 * 1024 * 1024 + 1) }]) {
    expect(isDiagramResponse(response)).toBe(false)
  }
})
