// @vitest-environment jsdom
import { act, createElement, useLayoutEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePhonePanelRail } from './usePhonePanelRail'
import { createPhonePanGesture } from './phoneNativePanGesture'
import type { PhoneWorkspaceState } from './phoneWorkspaceTransitions'

const animation = vi.hoisted(() => ({ timing: vi.fn((target: number) => target), cancel: vi.fn(), reduceMotion: false,
  sharedReads: vi.fn(), renderReads: vi.fn() }))
class Value<T> {
  constructor(public value: T) {}
  get() { animation.sharedReads(); return this.value }
  set(next: T | ((current: T) => T)) {
    this.value = typeof next === 'function' ? (next as (current: T) => T)(this.value) : next
  }
}
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ left: 0, right: 0 }) }))
vi.mock('react-native-reanimated', () => ({
  useSharedValue: <T,>(initial: T) => useRef(new Value(initial)).current,
  useReducedMotion: () => animation.reduceMotion,
  withTiming: animation.timing, cancelAnimation: animation.cancel,
}))
vi.mock('./phoneNativePanGesture', () => ({ createPhonePanGesture: vi.fn(() => ({})) }))
const roots: ReturnType<typeof createRoot>[] = []
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); animation.reduceMotion = false })
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  vi.unstubAllGlobals()
})

it('initializes at the actual pane position with one stable native gesture', async () => {
  const rail = await mountRail()
  expect(rail.current.offset.get()).toBe(-304)
  await rail.render('list')
  expect(rail.current.gesture).toBe(rail.gesture)
  expect(createPhonePanGesture).toHaveBeenCalledOnce()
  expect(animation.timing).not.toHaveBeenCalled()
})

it('does not read UI-thread shared values during React rendering', async () => {
  const rail = await mountRail()
  await rail.render('editor')
  expect(animation.renderReads).toHaveBeenCalled()
  for (const [reads] of animation.renderReads.mock.calls) expect(reads).toBe(0)
})

it('invalidates an active drag and rejects queued completion after unmount', async () => {
  const rail = await mountRail()
  const options = gestureOptions(), ticket = options.epoch.get()
  options.session.set({ ...options.session.get(), mode: 'move' })
  await rail.unmount()
  expect(options.session.get().mode).toBe('fail')
  options.onSettle('editor', ticket)
  expect(rail.navigate).not.toHaveBeenCalled()
})

it('does not reset or replay an entrance after a native settle', async () => {
  const rail = await mountRail()
  const options = gestureOptions()
  options.offset.set(-694)
  options.onSettle('editor', options.epoch.get())
  expect(rail.navigate).toHaveBeenCalledExactlyOnceWith('editor')
  await rail.render('editor')
  expect(rail.current.offset.get()).toBe(-694)
  expect(animation.timing).not.toHaveBeenCalled()
})

it('animates button navigation once without recreating the gesture', async () => {
  const rail = await mountRail()
  await rail.render('editor')
  await rail.render('editor')
  expect(animation.timing).toHaveBeenCalledExactlyOnceWith(-694, { duration: 180 })
  expect(createPhonePanGesture).toHaveBeenCalledOnce()
})

it('snaps to resized pane geometry and rejects an older queued gesture completion', async () => {
  const rail = await mountRail('editor')
  const options = gestureOptions(), ticket = options.epoch.get()
  await rail.render('editor', 844)
  expect(rail.current.offset.get()).toBe(-1164)
  options.onSettle('list', ticket)
  expect(rail.navigate).not.toHaveBeenCalled()
  expect(animation.timing).not.toHaveBeenCalled()
  expect(rail.current.gesture).toBe(rail.gesture)
})

it('honors reduced motion for button navigation', async () => {
  const rail = await mountRail()
  animation.reduceMotion = true
  await rail.render('editor')
  expect(animation.timing).toHaveBeenCalledExactlyOnceWith(-694, { duration: 0 })
})

function gestureOptions() {
  const options = vi.mocked(createPhonePanGesture).mock.calls.at(-1)?.[0]
  if (!options) throw new Error('Native gesture was not constructed')
  return options
}

async function mountRail(initial: PhoneWorkspaceState = 'list') {
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  const navigate = vi.fn()
  let current: ReturnType<typeof usePhonePanelRail> | undefined
  function Probe({ state, width }: { state: PhoneWorkspaceState; width: number }) {
    useLayoutEffect(() => { animation.renderReads(animation.sharedReads.mock.calls.length) })
    const rail = usePhonePanelRail(state, width, navigate)
    useLayoutEffect(() => { current = rail; animation.sharedReads.mockClear() }, [rail])
    return null
  }
  const render = (state: PhoneWorkspaceState, width = 390) => act(async () => root.render(createElement(Probe, { state, width })))
  await render(initial)
  function read() {
    if (!current) throw new Error('Rail was not mounted')
    return current
  }
  const unmount = async () => {
    await act(async () => root.unmount())
    roots.splice(roots.indexOf(root), 1)
  }
  return { get current() { return read() }, gesture: read().gesture, navigate, render, unmount }
}
