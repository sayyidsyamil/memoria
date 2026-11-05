import { expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  desktopEditorParity,
  desktopParityColors,
} from '../src/ui/desktopParity'

type ThemeJson = {
  blockquote: {
    marginVertical: number
    paddingLeft: number
  }
  checkboxes: {
    gap: number
    size: number
  }
  editor: {
    fontSize: number
    lineHeight: number
    maxWidth: number
    paddingHorizontal: number
    paddingVertical: number
    paragraphSpacing: number
  }
  headings: {
    h1: HeadingTheme
    h2: HeadingTheme
    h3: HeadingTheme
    h4: HeadingTheme
  }
  horizontalRule: {
    marginVertical: number
    thickness: number
  }
  inlineStyles: {
    code: {
      fontSize: number
      paddingHorizontal: number
      paddingVertical: number
    }
  }
  lists: {
    bulletGap: number
    bulletSize: number
    indentSize: number
    itemSpacing: number
    paddingLeft: number
  }
  table: {
    cellPaddingHorizontal: number
    cellPaddingVertical: number
    fontSize: number
  }
}

type HeadingTheme = {
  fontSize: number
  lineHeight: number
  marginBottom: number
  marginTop: number
}

const desktopColorVariables = {
  accentBlue: 'accent-blue',
  accentBlueLight: 'accent-blue-light',
  accentGreen: 'accent-green',
  accentGreenLight: 'accent-green-light',
  accentOrange: 'accent-orange',
  accentOrangeLight: 'accent-orange-light',
  accentPurple: 'accent-purple',
  accentPurpleLight: 'accent-purple-light',
  accentRed: 'accent-red',
  accentRedLight: 'accent-red-light',
  accentYellow: 'accent-yellow',
  accentYellowLight: 'accent-yellow-light',
  borderDefault: 'border-default',
  borderStrong: 'border-strong',
  stateHover: 'state-hover',
  stateHoverSubtle: 'state-hover-subtle',
  stateSelected: 'state-selected',
  stateSelectedStrong: 'state-selected-strong',
  surfaceApp: 'surface-app',
  surfaceButton: 'surface-button',
  surfaceCard: 'surface-card',
  surfaceEditor: 'surface-editor',
  surfaceSidebar: 'surface-sidebar',
  textFaint: 'text-faint',
  textInverse: 'text-inverse',
  textPrimary: 'text-primary',
  textSecondary: 'text-secondary',
} as const

export async function assertDesktopParitySources() {
  const [desktopCss, theme] = await Promise.all([
    readDesktopFile('src/index.css'),
    readDesktopTheme(),
  ])

  assertDesktopColorParity(desktopCss)
  assertDesktopEditorThemeParity(theme)
}

function assertDesktopColorParity(desktopCss: string) {
  const lightThemeVariables = parseLightThemeVariables(desktopCss)

  for (const [parityKey, variableName] of Object.entries(desktopColorVariables)) {
    expect(desktopParityColors[parityKey as keyof typeof desktopParityColors]).toBe(lightThemeVariables.get(variableName))
  }
}

function assertDesktopEditorThemeParity(theme: ThemeJson) {
  expect(desktopEditorParity.bodyFontSize).toBe(theme.editor.fontSize)
  expect(desktopEditorParity.bodyLineHeight).toBe(roundedLineHeight(theme.editor.fontSize, theme.editor.lineHeight))
  expect(desktopEditorParity.contentMaxWidth).toBe(theme.editor.maxWidth)
  expect(desktopEditorParity.contentPaddingHorizontal).toBe(theme.editor.paddingHorizontal)
  expect(desktopEditorParity.contentPaddingVertical).toBe(theme.editor.paddingVertical)
  expect(desktopEditorParity.paragraphSpacing).toBe(theme.editor.paragraphSpacing)
  expect(desktopEditorParity.h1FontSize).toBe(theme.headings.h1.fontSize)
  expect(desktopEditorParity.h1LineHeight).toBe(roundedLineHeight(theme.headings.h1.fontSize, theme.headings.h1.lineHeight))
  expect(desktopEditorParity.h1MarginBottom).toBe(theme.headings.h1.marginBottom)
  expect(desktopEditorParity.h2FontSize).toBe(theme.headings.h2.fontSize)
  expect(desktopEditorParity.h2LineHeight).toBe(roundedLineHeight(theme.headings.h2.fontSize, theme.headings.h2.lineHeight))
  expect(desktopEditorParity.h2MarginBottom).toBe(theme.headings.h2.marginBottom)
  expect(desktopEditorParity.h2MarginTop).toBe(theme.headings.h2.marginTop)
  expect(desktopEditorParity.h3FontSize).toBe(theme.headings.h3.fontSize)
  expect(desktopEditorParity.h3LineHeight).toBe(roundedLineHeight(theme.headings.h3.fontSize, theme.headings.h3.lineHeight))
  expect(desktopEditorParity.h3MarginBottom).toBe(theme.headings.h3.marginBottom)
  expect(desktopEditorParity.h3MarginTop).toBe(theme.headings.h3.marginTop)
  expect(desktopEditorParity.h4FontSize).toBe(theme.headings.h4.fontSize)
  expect(desktopEditorParity.h4LineHeight).toBe(roundedLineHeight(theme.headings.h4.fontSize, theme.headings.h4.lineHeight))
  expect(desktopEditorParity.h4MarginBottom).toBe(theme.headings.h4.marginBottom)
  expect(desktopEditorParity.h4MarginTop).toBe(theme.headings.h4.marginTop)
  expect(desktopEditorParity.horizontalRuleMarginVertical).toBe(theme.horizontalRule.marginVertical)
  expect(desktopEditorParity.horizontalRuleThickness).toBe(theme.horizontalRule.thickness)
  expect(desktopEditorParity.inlineCodeFontSize).toBe(theme.inlineStyles.code.fontSize)
  expect(desktopEditorParity.inlineCodePaddingHorizontal).toBe(theme.inlineStyles.code.paddingHorizontal)
  expect(desktopEditorParity.inlineCodePaddingVertical).toBe(theme.inlineStyles.code.paddingVertical)
  expect(desktopEditorParity.listCheckboxGap).toBe(theme.checkboxes.gap)
  expect(desktopEditorParity.listCheckboxSize).toBe(theme.checkboxes.size)
  expect(desktopEditorParity.listBulletGap).toBe(theme.lists.bulletGap)
  expect(desktopEditorParity.listBulletSize).toBe(theme.lists.bulletSize)
  expect(desktopEditorParity.listIndentSize).toBe(theme.lists.indentSize)
  expect(desktopEditorParity.listItemSpacing).toBe(theme.lists.itemSpacing)
  expect(desktopEditorParity.listPaddingLeft).toBe(theme.lists.paddingLeft)
  expect(desktopEditorParity.quoteMarginVertical).toBe(theme.blockquote.marginVertical)
  expect(desktopEditorParity.quotePaddingLeft).toBe(theme.blockquote.paddingLeft)
  expect(desktopEditorParity.tableCellPaddingHorizontal).toBe(theme.table.cellPaddingHorizontal)
  expect(desktopEditorParity.tableCellPaddingVertical).toBe(theme.table.cellPaddingVertical)
  expect(desktopEditorParity.tableFontSize).toBe(theme.table.fontSize)
}

function parseLightThemeVariables(desktopCss: string) {
  const lightThemeCss = cssBlockBetween(desktopCss, ':root,\n[data-theme="light"]', ':root.dark')
  const variables = new Map<string, string>()
  const variablePattern = /--([\w-]+):\s*([^;]+);/g
  let match = variablePattern.exec(lightThemeCss)

  while (match) {
    variables.set(match[1], match[2].trim())
    match = variablePattern.exec(lightThemeCss)
  }

  return variables
}

function cssBlockBetween(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  if (start === -1 || end === -1) throw new Error('Unable to locate desktop light theme CSS block.')
  return source.slice(start, end)
}

async function readDesktopTheme() {
  return JSON.parse(await readDesktopFile('src/theme.json')) as ThemeJson
}

async function readDesktopFile(path: string) {
  return readFile(join(repoRoot(), path), 'utf8')
}

function repoRoot() {
  return process.cwd().endsWith('/apps/mobile') ? join(process.cwd(), '../..') : process.cwd()
}

function roundedLineHeight(fontSize: number, lineHeight: number) {
  return Math.round(fontSize * lineHeight)
}
