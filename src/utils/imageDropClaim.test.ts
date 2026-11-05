import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImageDropClaim } from './imageDropClaim'

afterEach(() => { vi.restoreAllMocks() })

describe('image drop claims', () => {
  it('pairs reordered multi-image payloads and consumes each counterpart once', () => {
    const drop = createImageDropClaim()
    expect(drop.claim({ channel: 'dom', filenames: ['a.png', 'b.png'] })).toBe(true)
    expect(drop.claim({ channel: 'native', filenames: ['b.png', 'a.png'] })).toBe(false)
    expect(drop.claim({ channel: 'native', filenames: ['a.png', 'b.png'] })).toBe(true)
  })

  it('keeps independent same-channel and different-file drops', () => {
    const drop = createImageDropClaim()
    expect(drop.claim({ channel: 'dom', filenames: ['a.png'] })).toBe(true)
    expect(drop.claim({ channel: 'dom', filenames: ['a.png'] })).toBe(true)
    expect(drop.claim({ channel: 'native', filenames: ['b.png'] })).toBe(true)
    expect(drop.claim({ channel: 'native', filenames: ['a.png'] })).toBe(false)
    expect(drop.claim({ channel: 'native', filenames: ['a.png'] })).toBe(false)
  })

  it('expires unmatched claims so a later drop is imported', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0)
    const drop = createImageDropClaim()
    expect(drop.claim({ channel: 'dom', filenames: ['a.png'] })).toBe(true)
    now.mockReturnValue(1000)
    expect(drop.claim({ channel: 'native', filenames: ['a.png'] })).toBe(true)
  })

  it('starts a fresh gesture without suppressing a repeated file', () => {
    const drop = createImageDropClaim()
    expect(drop.claim({ channel: 'dom', filenames: ['a.png'] })).toBe(true)
    drop.reset()
    expect(drop.claim({ channel: 'native', filenames: ['a.png'] })).toBe(true)
  })
})
