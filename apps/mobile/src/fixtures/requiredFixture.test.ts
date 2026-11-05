import { describe, expect, it } from 'vitest'
import { requiredFixture } from './requiredFixture'

describe('required fixture values', () => {
  it.each([undefined, null])('rejects an absent fixture %s instead of weakening an assertion', (value) => {
    expect(() => requiredFixture(value)).toThrow('Expected fixture value')
  })

  it.each([0, false, '', 'note.md'])('preserves the present fixture %s', (value) => {
    expect(requiredFixture(value)).toBe(value)
  })

  it('preserves object identity', () => {
    const note = { id: 'note.md' }
    expect(requiredFixture(note)).toBe(note)
  })
})
