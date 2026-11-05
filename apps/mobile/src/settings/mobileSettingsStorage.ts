import { parseMobileSettings, type MobileSettings } from './mobileSettings'

const settingsKey = 'memoria-mobile-settings'

export async function readMobileSettings() {
  return parseMobileSettings(globalThis.localStorage?.getItem(settingsKey) ?? null)
}

export async function writeMobileSettings(settings: MobileSettings) {
  const content = JSON.stringify(settings)
  parseMobileSettings(content)
  if (!globalThis.localStorage) throw new Error('settingsUnavailable')
  globalThis.localStorage.setItem(settingsKey, content)
}
