import { beforeEach, expect, it, vi } from 'vitest'
import { makeMutable } from 'react-native-reanimated'
import { createPhonePanGesture, type PhonePanSession } from './phoneNativePanGesture'
import { phoneRailBounds, type PhoneRailGeometry } from './phonePanelRail'

type Touches = { allTouches: Array<{ x: number; y: number }> }
type Manager = { activate: () => void; fail: () => void }
type Movement = { translationX: number; velocityX: number }
type Callbacks = {
  down?: (event: Touches, manager: Manager) => void
  move?: (event: Touches, manager: Manager) => void
  start?: (event: Movement) => void
  update?: (event: Movement) => void
  end?: (event: Movement) => void
  finalize?: (event: Movement, success: boolean) => void
}
const native = vi.hoisted(() => {
  const callbacks: Callbacks = {}
  class Pan {
    maxPointers = vi.fn(() => this)
    manualActivation = vi.fn(() => this)
    onTouchesDown(callback: NonNullable<Callbacks['down']>) { callbacks.down = callback; return this }
    onTouchesMove(callback: NonNullable<Callbacks['move']>) { callbacks.move = callback; return this }
    onStart(callback: NonNullable<Callbacks['start']>) { callbacks.start = callback; return this }
    onUpdate(callback: NonNullable<Callbacks['update']>) { callbacks.update = callback; return this }
    onEnd(callback: NonNullable<Callbacks['end']>) { callbacks.end = callback; return this }
    onFinalize(callback: NonNullable<Callbacks['finalize']>) { callbacks.finalize = callback; return this }
  }
  return { callbacks, pan: new Pan(), cancel: vi.fn(), dispatch: vi.fn(),
    timings: [] as Array<{ target: number; duration: number; complete: (finished: boolean) => void }> }
})
vi.mock('react-native-gesture-handler', () => ({ Gesture: { Pan: () => native.pan } }))
vi.mock('react-native-reanimated', () => ({
  makeMutable: <T,>(value: T) => ({ value }),
  cancelAnimation: native.cancel,
  runOnJS: (callback: unknown) => { native.dispatch(callback); return callback },
  withTiming: (target: number, config: { duration: number }, complete: (finished: boolean) => void) => {
    native.timings.push({ target, duration: config.duration, complete })
    return target
  },
}))
beforeEach(() => { vi.clearAllMocks(); native.timings.length = 0 })

it('owns only a single-pointer native pan with explicit horizontal activation', () => {
  prepare()
  expect(native.pan.maxPointers).toHaveBeenCalledExactlyOnceWith(1)
  expect(native.pan.manualActivation).toHaveBeenCalledExactlyOnceWith(true)
})

it('keeps vertical scrolling and multi-touch gestures with their content', () => {
  const { manager } = prepare()
  native.callbacks.down?.({ allTouches: [{ x: 100, y: 100 }, { x: 120, y: 100 }] }, manager)
  native.callbacks.down?.(touch(100, 100), manager)
  native.callbacks.move?.(touch(104, 125), manager)
  expect(manager.fail).toHaveBeenCalledTimes(2)
  expect(manager.activate).not.toHaveBeenCalled()
  expect(native.timings).toHaveLength(0)
})

it('leaves leftward note-row swipes to the trailing actions', () => {
  const { manager } = prepare()
  native.callbacks.down?.(touch(100), manager)
  native.callbacks.move?.(touch(70), manager)
  expect(manager.fail).toHaveBeenCalledOnce()
  expect(manager.activate).not.toHaveBeenCalled()
})

it('subtracts activation travel instead of jumping when the native pan starts', () => {
  const options = prepare()
  begin(options.manager, 100, 130)
  native.callbacks.update?.(movement(35))
  expect(options.offset.value).toBe(-299)
  native.callbacks.end?.(movement(35))
  expect(options.onSettle).not.toHaveBeenCalled()
  expect(native.timings[0].target).toBe(-304)
  native.timings[0].complete(true)
  expect(options.onSettle).toHaveBeenCalledExactlyOnceWith('list', 1)
})

it('reverses from the presented animation position and rejects an old completion', () => {
  const options = prepare()
  begin(options.manager, 100, 130)
  native.callbacks.update?.(movement(280))
  native.callbacks.end?.(movement(280))
  const previous = native.timings[0]
  options.offset.value = -150
  begin(options.manager, 200, 170)
  expect(options.offset.value).toBe(-150)
  native.callbacks.update?.(movement(-50))
  expect(options.offset.value).toBe(-170)
  previous.complete(true)
  expect(options.onSettle).not.toHaveBeenCalled()
  expect(native.cancel).toHaveBeenCalledTimes(2)
})

it('settles cancellation without committing an interrupted animation', () => {
  const options = prepare()
  begin(options.manager, 100, 130)
  native.callbacks.update?.(movement(100))
  native.callbacks.finalize?.(movement(100), false)
  expect(options.session.value.mode).toBe('fail')
  expect(native.timings[0].target).toBe(-304)
  native.timings[0].complete(false)
  expect(options.onSettle).not.toHaveBeenCalled()
})

it('uses reduced-motion timing and only notifies after settling', () => {
  const options = prepare()
  options.geometry.value = { ...options.geometry.value, reduceMotion: true }
  begin(options.manager, 100, 130)
  native.callbacks.update?.(movement(320))
  native.callbacks.end?.(movement(320))
  expect(native.timings[0]).toMatchObject({ target: 0, duration: 0 })
  expect(options.onSettle).not.toHaveBeenCalled()
  native.timings[0].complete(true)
  expect(options.onSettle).toHaveBeenCalledExactlyOnceWith('sidebar', 1)
})

it('records native recognition and settlement snapshots only when diagnostics are requested', () => {
  const options = prepare()
  const trace = vi.fn()
  createPhonePanGesture({ ...options, onTrace: trace })
  begin(options.manager, 100, 130)
  native.callbacks.update?.(movement(350))
  native.callbacks.end?.(movement(350))
  native.callbacks.finalize?.(movement(350), true)
  native.timings[0].complete(true)

  expect(trace.mock.calls.map(([event]) => event.phase)).toEqual([
    'down', 'intent', 'start', 'end', 'settle', 'finalize', 'settled',
  ])
  expect(trace.mock.calls[0][0]).toMatchObject({ x: 100, y: 100, offset: -304, width: 390, mode: 'wait' })
  expect(trace.mock.calls[1][0]).toMatchObject({ mode: 'move', translationX: 30, translationY: 0 })
  expect(trace.mock.calls[4][0]).toMatchObject({ target: 'sidebar', epoch: 1 })
  expect(trace.mock.calls[6][0]).toMatchObject({ success: true, offset: 0, ticket: 1 })
})

it('adds no diagnostic JS dispatch to ordinary gestures', () => {
  const options = prepare()
  begin(options.manager, 100, 130)
  native.callbacks.update?.(movement(350))
  native.callbacks.end?.(movement(350))
  native.callbacks.finalize?.(movement(350), true)
  expect(native.dispatch).not.toHaveBeenCalled()
  native.timings[0].complete(true)
  expect(native.dispatch).toHaveBeenCalledExactlyOnceWith(options.onSettle)
})

function prepare() {
  const geometry = makeMutable<PhoneRailGeometry>({ width: 390 })
  const offset = makeMutable(-304), epoch = makeMutable(0)
  const session = makeMutable<PhonePanSession>({ x: 0, y: 0, base: -304, translation: 0,
    mode: 'fail', bounds: phoneRailBounds(-304, 390) })
  const onSettle = vi.fn(), manager = { activate: vi.fn(), fail: vi.fn() }
  createPhonePanGesture({ geometry, offset, epoch, session, onSettle })
  expect(Object.values(native.callbacks)).toHaveLength(6)
  return { geometry, offset, epoch, session, onSettle, manager }
}
function touch(x: number, y = 100): Touches { return { allTouches: [{ x, y }] } }
function movement(translationX: number): Movement { return { translationX, velocityX: 0 } }
function begin(manager: Manager, start: number, moved: number) {
  native.callbacks.down?.(touch(start), manager)
  native.callbacks.move?.(touch(moved), manager)
  expect(manager.activate).toHaveBeenCalled()
  native.callbacks.start?.(movement(moved - start))
}
