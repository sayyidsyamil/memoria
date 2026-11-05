import { describe, expect, it } from 'vitest'
import { clientColor, initials, MAX_NAME_LENGTH, PRESENCE_COLORS, presentUsers, safeColor, safeName, userColor } from '../src/presence.ts'

describe('presence', () => {
  it('lists who announced a user, the viewer first and the others by name', () => {
    const states = new Map<number, unknown>([
      [3, { user: { name: 'Luca', color: '#111111' } }],
      [1, { user: { name: 'Ada', color: '#222222' } }],
      [2, { user: { name: 'Me', color: '#333333' } }],
      [4, { cursor: 'no user yet' }],
      [5, null],
    ])

    expect(presentUsers(states, 2).map(({ name, self }) => [name, self])).toEqual([
      ['Me', true],
      ['Ada', false],
      ['Luca', false],
    ])
  })

  it('falls back to a placeholder name and a derived colour', () => {
    const [user] = presentUsers(new Map([[1, { user: { name: '  ', color: 7 } }]]), 9)

    expect(user).toEqual({ clientId: 1, name: '?', color: userColor('?'), self: false })
  })

  it.each([
    ['red; background: url(https://evil.test)'],
    ['url(javascript:alert(1))'],
    ['#12345'],
    [`#${'a'.repeat(10_000)}`],
    ['rgb(1, 2, 3)'],
  ])('replaces the announced colour %j with the derived one', (color) => {
    const [user] = presentUsers(new Map([[1, { user: { name: 'Ada', color } }]]), 9)

    expect(user.color).toBe(userColor('Ada'))
  })

  it('cuts an oversized name a peer announces', () => {
    const [user] = presentUsers(new Map([[1, { user: { name: 'é'.repeat(10_000) } }]]), 9)

    expect([...user.name]).toHaveLength(MAX_NAME_LENGTH)
    expect(safeName(42)).toBe('?')
  })

  it('accepts only a plain hex colour from a peer', () => {
    expect([safeColor('#1971C2'), safeColor(' #1971c2'), safeColor(null)]).toEqual(['#1971C2', null, null])
  })

  it('gives a name the same colour every time, from the palette', () => {
    expect(userColor('Ada Lovelace')).toBe(userColor('Ada Lovelace'))
    expect(PRESENCE_COLORS).toContain(userColor('Luca'))
  })

  it('gives each open document a palette colour, so two windows of one device differ', () => {
    expect([clientColor(0), clientColor(1), clientColor(8)]).toEqual([PRESENCE_COLORS[0], PRESENCE_COLORS[1], PRESENCE_COLORS[0]])
    expect(PRESENCE_COLORS).toContain(clientColor(-3))
    expect(clientColor(Number.NaN)).toBe(PRESENCE_COLORS[0])
  })

  it.each([
    ['Ada Lovelace', 'AL'],
    ['luca', 'L'],
    ['  Jean   Luc  Picard ', 'JP'],
    ['', '?'],
    ['émile zola', 'ÉZ'],
  ])('shortens %j to %j', (name, expected) => {
    expect(initials(name)).toBe(expected)
  })
})
