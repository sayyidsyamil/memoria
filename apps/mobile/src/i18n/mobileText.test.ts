import { describe, expect, it } from 'vitest'
import { mobileCopy, mobileText } from './mobileText'

describe('mobileText', () => {
  it('uses desktop locale keys for foundation UI copy', () => {
    expect(mobileText('sidebar.nav.inbox')).toBe('Inbox')
    expect(mobileCopy.properties).toBe('Properties')
  })
})
