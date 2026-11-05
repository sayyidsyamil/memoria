// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MobileThemeProvider } from './MobileThemeProvider'
import { mobilePalettes } from './mobilePalette'
import { mobileMetrics } from '../mobileMetrics'
import { createSourceEditorStyles } from '../../components/workspace/MobileMarkdownSourceEditorStyles'

const native = vi.hoisted(() => ({ theme: 'system', os: 'ios', setColorScheme: vi.fn() }))
let root: Root | null = null

function mountTheme() {
  root = createRoot(document.createElement('div'))
  flushSync(() => root?.render(createElement(MobileThemeProvider, null, 'content')))
}

function unmountTheme() {
  flushSync(() => root?.unmount())
  root = null
}

vi.mock('react-native', () => ({
  Appearance: { setColorScheme: native.setColorScheme },
  Platform: { get OS() { return native.os } },
  StyleSheet: {
    absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
    hairlineWidth: 1,
    create: (styles: unknown) => styles,
  },
  useColorScheme: () => 'dark',
  View: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('nativewind', () => ({ vars: (values: unknown) => values }))
vi.mock('../../settings/useMobileSettings', () => ({
  useMobileSettings: () => ({ settings: { theme: native.theme, uiScale: 1.2 } }),
}))

beforeEach(() => {
  native.theme = 'system'
  native.os = 'ios'
  native.setColorScheme.mockClear()
})
afterEach(unmountTheme)

it.each(['system', 'light', 'dark'])('applies %s appearance through the supported native API', theme => {
  native.theme = theme
  mountTheme()
  expect(native.setColorScheme).toHaveBeenLastCalledWith(theme === 'system' ? 'unspecified' : theme)
  unmountTheme()
  expect(native.setColorScheme).toHaveBeenLastCalledWith('unspecified')
})

it('leaves browser appearance ownership unchanged', () => {
  native.os = 'web'
  mountTheme()
  unmountTheme()
  expect(native.setColorScheme).not.toHaveBeenCalled()
})

it.each(['light', 'dark'] as const)('retains source-input geometry with the %s palette', mode => {
  for (const metrics of Object.values(mobileMetrics)) {
    const { editorStyles } = createSourceEditorStyles(mobilePalettes[mode], metrics)
    expect(editorStyles.highlightedInput).toMatchObject({
      position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
      fontSize: metrics.editor.bodyFontSize, paddingHorizontal: metrics.space.md,
    })
  }
})
