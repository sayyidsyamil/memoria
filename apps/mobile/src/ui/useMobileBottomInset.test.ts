// @vitest-environment jsdom
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { describe, expect, it, vi } from 'vitest'
import { useMobileBottomInset } from './useMobileBottomInset'

const keyboard = vi.hoisted(() => ({
  visible: false,
  listeners: new Map<string, () => void>(),
}))
vi.mock('react-native', () => ({ Keyboard: {
  isVisible: () => keyboard.visible,
  addListener: (name: string, callback: () => void) => {
    keyboard.listeners.set(name, callback)
    return { remove: () => keyboard.listeners.delete(name) }
  },
} }))
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 34 }) }))

function Probe() {
  return createElement('output', null, useMobileBottomInset())
}

describe('bottom control safe area', () => {
  it.each([false, true])('does not add a home-indicator band above a visible keyboard (initial: %s)', (visible) => {
    keyboard.visible = visible
    const host = document.createElement('div')
    const root = createRoot(host)
    try {
      flushSync(() => root.render(createElement(Probe)))
      expect(host.textContent).toBe(visible ? '0' : '34')
      flushSync(() => keyboard.listeners.get('keyboardDidShow')?.())
      expect(host.textContent).toBe('0')
      flushSync(() => keyboard.listeners.get('keyboardDidHide')?.())
      expect(host.textContent).toBe('34')
    } finally { root.unmount() }
    expect(keyboard.listeners.size).toBe(0)
  })
})
