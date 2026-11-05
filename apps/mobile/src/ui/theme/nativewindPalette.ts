import desktopThemes from './desktopThemes.generated.json'
import type { MobileColorMode } from './mobilePalette'

const semanticRoles = [
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
  'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted',
  'muted-foreground', 'accent', 'accent-foreground', 'destructive', 'destructive-foreground',
  'border', 'input', 'ring',
] as const

export const nativewindPalettes = { light: nativewindPalette('light'), dark: nativewindPalette('dark') }

function nativewindPalette(mode: MobileColorMode): Record<string, string> {
  const theme = desktopThemes[mode]
  return {
    ...Object.fromEntries(semanticRoles.map(role => [`--${role}`, hexHslComponents(theme[`--${role}`])])),
    '--radius': theme['--radius'],
  }
}

// NativeWind's existing RNR classes consume HSL components, not full CSS colors.
export function hexHslComponents(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Expected a six-digit desktop color')
  const channels = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
  const max = Math.max(...channels)
  const min = Math.min(...channels)
  const lightness = (max + min) / 2
  const delta = max - min
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1))
  const hue = colorHue(channels, max, delta)
  return `${rounded(hue)} ${rounded(saturation * 100)}% ${rounded(lightness * 100)}%`
}

function colorHue([red, green, blue]: number[], max: number, delta: number) {
  if (delta === 0) return 0
  const channels = new Map([[red, (green - blue) / delta], [green, (blue - red) / delta + 2], [blue, (red - green) / delta + 4]])
  return (((channels.get(max) ?? 0) * 60) + 360) % 360
}

function rounded(value: number) {
  return Math.round(value * 100_000) / 100_000
}
