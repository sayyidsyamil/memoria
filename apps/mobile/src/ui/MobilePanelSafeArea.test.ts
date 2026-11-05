// @vitest-environment jsdom
import { createElement, type CSSProperties, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { expect, it, vi } from 'vitest'
import { MobilePanelSafeArea } from './MobilePanelSafeArea'

const viewport = vi.hoisted(() => ({ top: 24 }))
type SurfaceProps = { children?: ReactNode; style?: (CSSProperties | false | undefined)[]; pointerEvents?: string }
function Surface({ children, style, pointerEvents }: SurfaceProps) {
  return createElement('div', { style: Object.assign({}, ...style ?? []), 'data-pointer': pointerEvents }, children)
}
vi.mock('react-native', () => ({ View: Surface, StyleSheet: { create: (value: object) => value, hairlineWidth: 0.5 } }))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: viewport.top, bottom: 34, left: 0, right: 0 }),
  SafeAreaView: Surface,
}))
vi.mock('./theme/useMobileTheme', async () => {
  const { mobilePalettes } = await import('./theme/mobilePalette')
  return { useMobileStyles: (factory: (colors: object) => object) => factory(mobilePalettes.light) }
})

it.each([false, true])('preserves the known top inset on the first render and remount (sidebar: %s)', sidebar => {
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    for (const key of ['preview', 'workspace']) {
      viewport.top = 24
      flushSync(() => root.render(createElement(MobilePanelSafeArea, { key, sidebar, children: 'content' })))
      expect(host.querySelector<HTMLElement>('div')?.style.paddingTop).toBe('24px')
      expect(host.querySelector<HTMLElement>('div')?.style.paddingBottom).toBe('')
    }
    viewport.top = 59
    flushSync(() => root.render(createElement(MobilePanelSafeArea, { key: 'workspace', sidebar, children: 'content' })))
    expect(host.querySelector<HTMLElement>('div')?.style.paddingTop).toBe('59px')
    expect(host.querySelector<HTMLElement>('[data-pointer="none"]')?.style.height).toBe('59px')
  } finally { root.unmount() }
})
