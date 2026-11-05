import { describe, expect, it } from 'vitest'
import { resolveMobileMissingTypeName } from './mobileMissingType'

describe('mobile missing Type resolution', () => {
  it('matches desktop inspector semantics for existing and missing Type documents', () => {
    expect(resolveMobileMissingTypeName(
      { type: 'Essay' },
      { Essay: { path: 'essay.md' } },
    )).toBeNull()

    expect(resolveMobileMissingTypeName(
      { type: 'Hotel' },
      { Essay: { path: 'essay.md' } },
    )).toBe('Hotel')
  })

  it('does not warn for empty type values', () => {
    expect(resolveMobileMissingTypeName({ type: '  ' }, undefined)).toBeNull()
  })
})
