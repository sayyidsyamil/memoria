import { describe, expect, it } from 'vitest'
import { isPortableName } from './portableName'

/** The desktop's `filename_rules.rs` cases, so the web refuses the same names. */
describe('isPortableName', () => {
  it.each(['meeting-notes', 'draft.v2', 'Projects', ' padded ', 'Résumé 2026', 'console'])('accepts %j', (name) => {
    expect(isPortableName(name)).toBe(true)
  })

  it.each([
    '', '  ', '.', '..', 'trailing.', 'quarterly:plan', 'a/b', 'a\\b', 'what?', 'star*', 'pipe|', 'a<1', 'b>2', 'say"what',
    'tab\there', 'con', 'Lpt1', 'NUL.txt', 'com9.md',
  ])('refuses %j', (name) => {
    expect(isPortableName(name)).toBe(false)
  })
})
