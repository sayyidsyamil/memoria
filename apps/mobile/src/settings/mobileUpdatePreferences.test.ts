import { expect, it } from 'vitest'
import { parseMobileSettings } from './mobileSettings'

it('defaults fresh and existing installations to Stable without changing other preferences', () => {
  expect(parseMobileSettings(null)).toMatchObject({ updateChannel: 'stable' })
  expect(parseMobileSettings('{"autoGit":true,"theme":"dark"}')).toMatchObject({
    updateChannel: 'stable', autoGit: true, theme: 'dark',
  })
})

it('remembers Alpha opt-in and rejects arbitrary update channels', () => {
  expect(parseMobileSettings('{"updateChannel":"alpha"}')).toMatchObject({ updateChannel: 'alpha' })
  expect(() => parseMobileSettings('{"updateChannel":"untrusted"}')).toThrow()
})
