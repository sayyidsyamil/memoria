// @vitest-environment jsdom
import { act, createElement, useLayoutEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useTabletPanelGestures } from './useTabletPanelGestures'
import { createTabletPanGesture } from './tabletNativePanGesture'

const window = vi.hoisted(() => ({ width: 1400 }))
class Value<T> {
  constructor(public value: T) {}
  get() { return this.value }
  set(next: T | ((current: T) => T)) {
    this.value = typeof next === 'function' ? (next as (current: T) => T)(this.value) : next
  }
}
vi.mock('react-native', () => ({ useWindowDimensions: () => ({ width: window.width }) }))
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24 }) }))
vi.mock('react-native-reanimated', () => ({
  useSharedValue: <T,>(value: T) => useRef(new Value(value)).current,
  useAnimatedStyle: () => ({}), withSpring: (target: number) => target, cancelAnimation: vi.fn(),
}))
vi.mock('./tabletNativePanGesture', () => ({ createTabletPanGesture: vi.fn(() => ({})), tabletPanelSpring: {} }))
const roots: ReturnType<typeof createRoot>[] = []
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); window.width = 1400 })
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  vi.unstubAllGlobals()
})

it('rejects a queued drag settlement after a narrow-window resize', async () => {
  const panel = await mountPanel()
  const options = gestureOptions(), ticket = options.epoch?.get() ?? 0
  await panel.render(700)
  expect(panel.current.noteListVisible).toBe(false)
  await act(async () => options.onSettle({ stage: 'all', propertiesVisible: true }, ticket))
  expect(panel.current.noteListVisible).toBe(false)
  expect(panel.current.propertiesVisible).toBe(false)
})

it('rejects a queued drag settlement after an explicit pane action', async () => {
  const panel = await mountPanel()
  const options = gestureOptions(), ticket = options.epoch?.get() ?? 0
  await act(async () => panel.current.showEditorOnly())
  await act(async () => options.onSettle({ stage: 'all', propertiesVisible: true }, ticket))
  expect(panel.current.noteListVisible).toBe(false)
  expect(panel.current.propertiesVisible).toBe(false)
})

it('accepts current native settlement without recreating the gesture', async () => {
  const panel = await mountPanel()
  const options = gestureOptions(), ticket = options.epoch?.get() ?? 0
  await act(async () => options.onSettle({ stage: 'editor', propertiesVisible: true }, ticket))
  expect(panel.current.noteListVisible).toBe(false)
  expect(panel.current.propertiesVisible).toBe(true)
  expect(createTabletPanGesture).toHaveBeenCalledOnce()
})

it('invalidates its native drag and queued generation when unmounted', async () => {
  const panel = await mountPanel()
  const options = gestureOptions(), ticket = options.epoch.get()
  options.session.set({ ...options.session.get(), mode: 'properties' })
  await panel.unmount()
  expect(options.session.get().mode).toBe('fail')
  expect(options.epoch.get()).toBeGreaterThan(ticket)
})

function gestureOptions() {
  const options = vi.mocked(createTabletPanGesture).mock.calls.at(-1)?.[0]
  if (!options) throw new Error('Native gesture was not constructed')
  return options
}

async function mountPanel() {
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  let current: ReturnType<typeof useTabletPanelGestures> | undefined
  function Probe() {
    const panel = useTabletPanelGestures({ compactTablet: false, defaultSidebarVisible: true,
      defaultPropertiesVisible: false, exclusiveSidePanels: false, propertiesReplaceSidebar: false })
    useLayoutEffect(() => { current = panel }, [panel])
    return null
  }
  const render = async (width = window.width) => {
    window.width = width
    await act(async () => root.render(createElement(Probe)))
  }
  await render()
  const unmount = async () => {
    await act(async () => root.unmount())
    roots.splice(roots.indexOf(root), 1)
  }
  return { get current() {
    if (!current) throw new Error('Panel was not mounted')
    return current
  }, render, unmount }
}
