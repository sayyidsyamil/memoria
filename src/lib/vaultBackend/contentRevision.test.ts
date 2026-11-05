import { describe, expect, it } from 'vitest'
import { contentRevision } from './contentRevision'

describe('contentRevision', () => {
  it('is stable for identical content', () => {
    expect(contentRevision('# Note\n\nBody')).toBe(contentRevision('# Note\n\nBody'))
  })

  it('changes when the content changes', () => {
    const revisions = ['', ' ', '# Note', '# Note\n', '# Nota', 'héllo', 'hello'].map(contentRevision)
    expect(new Set(revisions).size).toBe(revisions.length)
  })

  it('is an opaque, versioned, fixed-width token', () => {
    expect(contentRevision('')).toMatch(/^h1-[0-9a-f]{16}$/)
    expect(contentRevision('x'.repeat(100_000))).toMatch(/^h1-[0-9a-f]{16}$/)
  })
})
