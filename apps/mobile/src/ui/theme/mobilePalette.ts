import desktopThemes from './desktopThemes.generated.json'

export type MobileColorMode = 'light' | 'dark'

const roles = {
  app: '--surface-app',
  border: '--border-default',
  borderStrong: '--border-strong',
  card: '--surface-card',
  blue: '--accent-blue',
  blueSoft: '--accent-blue-light',
  control: '--surface-button',
  controlPressed: '--border-strong',
  danger: '--accent-red',
  dangerSoft: '--accent-red-light',
  dialog: '--surface-dialog',
  editor: '--surface-editor',
  graySoft: '--state-hover-subtle',
  green: '--accent-green',
  greenSoft: '--accent-green-light',
  orange: '--accent-orange',
  orangeSoft: '--accent-orange-light',
  overlay: '--surface-overlay',
  popover: '--surface-popover',
  primary: '--accent-blue',
  primarySoft: '--accent-blue-light',
  purple: '--accent-purple',
  purpleSoft: '--accent-purple-light',
  red: '--accent-red',
  redSoft: '--accent-red-light',
  selected: '--state-selected',
  selectedStrong: '--state-selected-strong',
  sidebar: '--surface-sidebar',
  syntaxCode: '--syntax-monospace',
  syntaxHeading: '--syntax-heading',
  syntaxLink: '--syntax-link',
  syntaxMuted: '--syntax-muted',
  syntaxPropertyKey: '--syntax-frontmatter-key',
  text: '--text-primary',
  textFaint: '--text-faint',
  textHeading: '--text-heading',
  textInverse: '--text-inverse',
  textMuted: '--text-secondary',
  warning: '--feedback-warning-text',
  warningSoft: '--feedback-warning-bg',
  warningBorder: '--feedback-warning-border',
  yellow: '--accent-yellow',
  yellowSoft: '--accent-yellow-light',
} as const satisfies Record<string, keyof typeof desktopThemes.light>

export type MobileColors = Readonly<Record<keyof typeof roles, string>>

function palette(mode: MobileColorMode): MobileColors {
  const theme = desktopThemes[mode]
  return Object.freeze(Object.fromEntries(Object.entries(roles).map(([role, variable]) => [role, theme[variable]]))) as MobileColors
}

export const mobilePalettes = { light: palette('light'), dark: palette('dark') } as const

export function resolveMobileTheme(preference: MobileColorMode | 'system', system: string | null | undefined): MobileColorMode {
  if (preference !== 'system') return preference
  return system === 'dark' ? 'dark' : 'light'
}
