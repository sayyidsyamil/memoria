import { describe, expect, it } from 'vitest'
import { isNotePath, validSession } from '../src/sessionInput.ts'

const GOOD = { token: 'local-dev-token-0123456789', name: 'Ada Lovelace', note: 'projects/heron.md' }

describe('session input', () => {
  it('accepts a token, a name and a note path, trimmed', () => {
    expect(validSession({ token: ` ${GOOD.token} `, name: ' Ada Lovelace ', note: ' projects/heron.md ' })).toEqual(GOOD)
  })

  it.each([
    ['no token', { ...GOOD, token: '' }],
    ['a token with a space', { ...GOOD, token: 'two words' }],
    ['a token that is not text', { ...GOOD, token: 42 }],
    ['an oversized token', { ...GOOD, token: 'x'.repeat(513) }],
    ['no name', { ...GOOD, name: '   ' }],
    ['a name with a control character', { ...GOOD, name: 'Ada\u0007' }],
    ['an oversized name', { ...GOOD, name: 'a'.repeat(65) }],
    ['a path that climbs out', { ...GOOD, note: '../secrets.md' }],
    ['nothing at all', {}],
  ])('refuses %s', (_name, input) => {
    expect(validSession(input)).toBeNull()
  })

  it.each(['welcome.md', 'people/ada lovelace.md', 'café/note.md'])('takes %j as a note path', (note) => {
    expect(isNotePath(note)).toBe(true)
  })

  it.each([
    '',
    'welcome.txt',
    '/etc/passwd.md',
    'a//b.md',
    './a.md',
    'a/../b.md',
    '.git/config.md',
    '.GITHUB/x.md',
    'a\\b.md',
    'a\nb.md',
    `${'a'.repeat(1030)}.md`,
  ])('does not take %j as a note path', (note) => {
    expect(isNotePath(note)).toBe(false)
  })
})
