import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDesktopThemes } from './parseDesktopTheme'

describe('desktop theme export', () => {
  it('extracts both desktop palettes and resolves semantic aliases', () => {
    const themes = parseDesktopThemes(readFileSync('../../src/index.css', 'utf8'))
    expect(themes.light['--background']).toBe('#FFFFFF')
    expect(themes.dark['--background']).toBe('#1F1E1B')
    expect(themes.dark['--sidebar']).toBe('#191814')
    expect(themes.dark['--foreground']).toBe('#E6E1D8')
    expect(themes.dark['--primary-foreground']).toBe('#151411')
    expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort())
    expect(Object.values(themes.dark).some((value) => value.includes('var('))).toBe(false)
  })

  it('rejects incomplete palettes instead of silently exporting light-only tokens', () => {
    expect(() => parseDesktopThemes('[data-theme="light"] { --background: white; }')).toThrow('Missing desktop dark theme')
  })

  it('rejects missing aliases and cycles', () => {
    const sheet = (value: string) => `[data-theme="light"] { --a: ${value}; } [data-theme="dark"] { --a: black; }`
    expect(() => parseDesktopThemes(sheet('var(--missing)'))).toThrow('Missing theme variable --missing')
    expect(() => parseDesktopThemes(sheet('var(--a)'))).toThrow('Cyclic theme variable --a')
  })

  it('resolves repeated aliases inside CSS functions and rejects nested cycles', () => {
    const sheet = (value: string) => `[data-theme="light"] { --base: white; --a: ${value}; }
      [data-theme="dark"] { --base: black; }`
    const themes = parseDesktopThemes(sheet('color-mix(in srgb, var(--base) 50%, var( --base ))'))
    expect(themes.light['--a']).toBe('color-mix(in srgb, white 50%, white)')
    expect(themes.dark['--a']).toBe('color-mix(in srgb, black 50%, black)')
    expect(() => parseDesktopThemes(sheet('color-mix(in srgb, var(--a), transparent)')))
      .toThrow('Cyclic theme variable --a')
    expect(() => parseDesktopThemes(sheet('color-mix(in srgb, var(--missing), transparent)')))
      .toThrow('Missing theme variable --missing')
  })
})
