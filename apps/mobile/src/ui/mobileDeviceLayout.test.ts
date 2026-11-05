import { describe, expect, it } from 'vitest'
import { mobileDeviceLayout } from './mobileDeviceLayout'

describe('mobile device layout', () => {
  it.each([393, 874, 956])('keeps an iPhone compact at width %i', (width) => {
    expect(mobileDeviceLayout({ platform: 'ios', tablet: false, width, screenWidth: 440, screenHeight: 956 })).toBe('phone')
  })

  it('keeps iPad controls in a narrow window', () => {
    expect(mobileDeviceLayout({ platform: 'ios', tablet: true, width: 768, screenWidth: 768, screenHeight: 1024 })).toBe('tablet')
  })

  it('uses the Android device dimensions, not keyboard-reduced window height', () => {
    expect(mobileDeviceLayout({ platform: 'android', width: 1000, screenWidth: 800, screenHeight: 1280 })).toBe('tablet')
    expect(mobileDeviceLayout({ platform: 'android', width: 900, screenWidth: 412, screenHeight: 900 })).toBe('phone')
  })

  it('keeps browser previews responsive', () => {
    expect(mobileDeviceLayout({ platform: 'web', width: 899, screenWidth: 1920, screenHeight: 1080 })).toBe('phone')
    expect(mobileDeviceLayout({ platform: 'web', width: 900, screenWidth: 1920, screenHeight: 1080 })).toBe('tablet')
  })
})
