import { beforeEach, expect, it, vi } from 'vitest'
import { makeMutable } from 'react-native-reanimated'
import { createTabletPanGesture, type TabletPanSession } from './tabletNativePanGesture'

type Movement = { translationX: number; velocityX: number }
type Callbacks = {
  down?: (event: { allTouches: Array<{ x: number; y: number }> }) => void
  start?: () => void
  update?: (event: Movement) => void
  end?: (event: Movement) => void
  finalize?: (event: Movement, success: boolean) => void
}
const native = vi.hoisted(() => {
  const callbacks: Callbacks = {}
  class Pan {
    maxPointers() { return this }
    manualActivation() { return this }
    onTouchesDown(callback: NonNullable<Callbacks['down']>) { callbacks.down = callback; return this }
    onTouchesMove() { return this }
    onStart(callback: NonNullable<Callbacks['start']>) { callbacks.start = callback; return this }
    onUpdate(callback: NonNullable<Callbacks['update']>) { callbacks.update = callback; return this }
    onEnd(callback: NonNullable<Callbacks['end']>) { callbacks.end = callback; return this }
    onFinalize(callback: NonNullable<Callbacks['finalize']>) { callbacks.finalize = callback; return this }
  }
  return { callbacks, pan: new Pan(), spring: vi.fn((target: number) => target), cancel: vi.fn() }
})
vi.mock('react-native-gesture-handler', () => ({ Gesture: { Pan: () => native.pan } }))
vi.mock('react-native-reanimated', () => ({
  makeMutable: <T,>(value: T) => ({ value }),
  cancelAnimation: native.cancel, withSpring: native.spring, runOnJS: (callback: unknown) => callback,
}))
beforeEach(() => vi.clearAllMocks())

it.each(['wait', 'fail'] as const)('ignores late updates after a session becomes %s', mode => {
  const options = prepare('properties')
  options.session.value = { ...options.session.value, mode }
  native.callbacks.start?.()
  native.callbacks.update?.({ translationX: -120, velocityX: 0 })
  expect(options.motion.properties.value).toBe(300)
  expect(options.motion.left.value).toBe(0)
  expect(native.spring).not.toHaveBeenCalled()
  expect(native.cancel).not.toHaveBeenCalled()
})

it('starts a new generation for a new touch sequence', () => {
  const options = prepare('fail')
  native.callbacks.down?.({ allTouches: [{ x: 100, y: 40 }] })
  expect(options.epoch.value).toBe(1)
  expect(options.session.value.mode).toBe('wait')
})

it.each(['wait', 'fail'] as const)('ignores late completion after a session becomes %s', mode => {
  const options = prepare('left')
  options.session.value = { ...options.session.value, mode }
  native.callbacks.end?.({ translationX: -120, velocityX: -1000 })
  native.callbacks.finalize?.({ translationX: -120, velocityX: -1000 }, false)
  expect(options.onSettle).not.toHaveBeenCalled()
  expect(native.spring).not.toHaveBeenCalled()
})

it('retains ordinary left-panel dragging and settlement', () => {
  const options = prepare('left')
  native.callbacks.update?.({ translationX: -200, velocityX: 0 })
  expect(options.motion.left.value).toBe(-200)
  native.callbacks.end?.({ translationX: -200, velocityX: 0 })
  expect(options.onSettle).toHaveBeenCalledOnce()
  expect(native.spring).toHaveBeenCalledTimes(2)
})

it('settles a cancelled active inspector drag without losing its chosen visibility', () => {
  const options = prepare('properties')
  native.callbacks.update?.({ translationX: -220, velocityX: 0 })
  native.callbacks.finalize?.({ translationX: -220, velocityX: 0 }, false)
  expect(options.motion.properties.value).toBe(0)
  expect(options.onSettle).toHaveBeenCalledExactlyOnceWith({ stage: 'all', propertiesVisible: true }, 0)
})

function prepare(mode: TabletPanSession['mode']) {
  const motion = { left: makeMutable(0), properties: makeMutable(300), restoreLeft: makeMutable(0) }
  const session = makeMutable<TabletPanSession>({ x: 0, y: 0, left: 0, properties: 300, mode })
  const options = { compactTablet: false, propertiesReplaceSidebar: false, width: 1400, topInset: 24,
    motion, session, epoch: makeMutable(0), onSettle: vi.fn() }
  createTabletPanGesture(options)
  return options
}
