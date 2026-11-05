import { expect, it } from 'vitest'
import { parseMobileSettings } from '../settings/mobileSettings'

it('does not turn prior analytics consent into crash-reporting consent', () => {
  expect(parseMobileSettings('{"analytics":true}')).toMatchObject({ analytics: true, crashReporting: false })
  expect(parseMobileSettings(null)).toMatchObject({ analytics: false, crashReporting: false })
})

it('round-trips independent consent and rejects truthy strings', () => {
  const settings = parseMobileSettings('{"crashReporting":true,"analytics":false}')
  expect(parseMobileSettings(JSON.stringify(settings))).toEqual(settings)
  expect(() => parseMobileSettings('{"crashReporting":"true"}')).toThrow()
})
