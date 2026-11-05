import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import generatedThemes from './desktopThemes.generated.json'
import { mobilePalettes, resolveMobileTheme } from './mobilePalette'
import { parseDesktopThemes } from './parseDesktopTheme'
import { mobileColors } from '../tokens'

describe('mobile palette contract', () => {
  it('keeps generated tokens identical to desktop CSS', () => {
    expect(generatedThemes).toEqual(parseDesktopThemes(readFileSync('../../src/index.css', 'utf8')))
  })

  it('preserves existing light roles and provides every role in dark mode', () => {
    expect(mobilePalettes.light).toMatchObject(mobileColors)
    expect(Object.keys(mobilePalettes.dark)).toEqual(Object.keys(mobilePalettes.light))
    expect(mobilePalettes.dark.text).toBe('#E6E1D8')
    expect(mobilePalettes.dark.editor).toBe('#1F1E1B')
    expect(mobilePalettes.dark.sidebar).toBe('#191814')
    expect(mobilePalettes.dark.primary).toBe('#78A4FF')
    expect(mobilePalettes.dark.textInverse).toBe('#151411')
  })

  it('uses system appearance only when requested, defaulting to light without a system value', () => {
    expect(resolveMobileTheme('system', 'dark')).toBe('dark')
    expect(resolveMobileTheme('light', 'dark')).toBe('light')
    expect(resolveMobileTheme('dark', 'light')).toBe('dark')
    expect(resolveMobileTheme('system', null)).toBe('light')
  })
})
