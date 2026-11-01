import { describe, expect, it } from 'vitest'
import { assertNativeQaOpenUrl } from './nativeQaUrls'

describe('native QA URLs', () => {
  it('accepts Expo Go and Memoria native deep links', () => {
    expect(() => assertNativeQaOpenUrl('exp://127.0.0.1:8081/--/?layoutProbe=1', 'QA')).not.toThrow()
    expect(() => assertNativeQaOpenUrl('exps://192.168.1.10:8081/--/?layoutProbe=1', 'QA')).not.toThrow()
    expect(() => assertNativeQaOpenUrl('memoria://mobile-ui-lab?layoutProbe=1', 'QA')).not.toThrow()
  })

  it('rejects browser URLs because they open Mobile Safari', () => {
    expect(() => assertNativeQaOpenUrl('http://localhost:8081', 'QA')).toThrow('Mobile Safari')
    expect(() => assertNativeQaOpenUrl('https://example.com', 'QA')).toThrow('Mobile Safari')
  })

  it('rejects invalid and unsupported URLs', () => {
    expect(() => assertNativeQaOpenUrl('not a url', 'QA')).toThrow('Invalid simulator URL')
    expect(() => assertNativeQaOpenUrl('mailto:team@example.com', 'QA')).toThrow('native app deep link')
  })
})
