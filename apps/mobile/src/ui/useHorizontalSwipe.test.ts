// @vitest-environment jsdom
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanResponderGestureState } from 'react-native'
import { useHorizontalSwipe } from './useHorizontalSwipe'

const responder = vi.hoisted(() => vi.fn((callbacks: object) => ({ panHandlers: callbacks })))
vi.mock('react-native', () => ({ PanResponder: { create: responder } }))

type Options = Parameters<typeof useHorizontalSwipe>[0]
type Callbacks = {
  onStartShouldSetPanResponderCapture?: (event: { nativeEvent: { pageX: number; pageY: number } }) => boolean
  onMoveShouldSetPanResponderCapture: (event: null, gesture: Pick<PanResponderGestureState,
    'x0' | 'y0' | 'moveX' | 'moveY' | 'dx' | 'dy' | 'numberActiveTouches'>) => boolean
  onPanResponderRelease: (event: null, gesture: { dx: number; dy: number }) => void
  onPanResponderMove: (event: null, gesture: { dx: number; dy: number }) => void
  onPanResponderTerminate: () => void
}

function Surface(props: Options) {
  useHorizontalSwipe(props)
  return null
}

afterEach(() => responder.mockClear())

describe('native horizontal gesture continuity', () => {
  it('only captures rightward list navigation, leaving left row actions and vertical scrolling alone', () => {
    const root = createRoot(document.createElement('div'))
    try {
      flushSync(() => root.render(createElement(Surface, { direction: 'right', onSwipeRight: vi.fn() })))
      const callbacks = responder.mock.calls[0][0] as Callbacks
      callbacks.onStartShouldSetPanResponderCapture?.({ nativeEvent: { pageX: 180, pageY: 400 } })
      const gesture = { x0: 0, y0: 0, moveX: 220, moveY: 402, dx: 40, dy: 2, numberActiveTouches: 1 }
      expect(callbacks.onMoveShouldSetPanResponderCapture(null, gesture)).toBe(true)
      expect(callbacks.onMoveShouldSetPanResponderCapture(null, { ...gesture, dx: -40 })).toBe(false)
      expect(callbacks.onMoveShouldSetPanResponderCapture(null, { ...gesture, dy: 60 })).toBe(false)
      expect(callbacks.onMoveShouldSetPanResponderCapture(null, { ...gesture, numberActiveTouches: 2 })).toBe(false)
    } finally { root.unmount() }
  })

  it.each([
    { startX: 200, touches: 1, captures: false },
    { startX: 10, touches: 1, captures: true },
    { startX: 390, touches: 1, captures: true },
    { startX: 10, touches: 2, captures: false },
  ])('checks the pre-grant touch origin and pointer count: $startX / $touches', ({ startX, touches, captures }) => {
    const root = createRoot(document.createElement('div'))
    const canStart = (start: { x: number; y: number }) => start.x < 24 || start.x > 378
    try {
      flushSync(() => root.render(createElement(Surface, { canStart })))
      const callbacks = responder.mock.calls[0][0] as Callbacks
      callbacks.onStartShouldSetPanResponderCapture?.({ nativeEvent: { pageX: startX, pageY: 400 } })
      // Native PanResponder leaves x0/y0 at zero until after capture is granted.
      // Its first movement sample need not start at the original touch-down.
      const initialDrift = startX < 24 ? 19 : -19
      const gesture = { x0: 0, y0: 0, moveX: startX + initialDrift - 40, moveY: 402, dx: -40, dy: 2, numberActiveTouches: touches }
      expect(callbacks.onMoveShouldSetPanResponderCapture(null, gesture)).toBe(captures)
    } finally { root.unmount() }
  })

  it('keeps the same responder during preview rerenders and uses the latest actions', () => {
    const root = createRoot(document.createElement('div'))
    const oldRight = vi.fn()
    const right = vi.fn()
    const end = vi.fn()
    try {
      flushSync(() => root.render(createElement(Surface, { onSwipeRight: oldRight })))
      flushSync(() => root.render(createElement(Surface, { onSwipeRight: right, onSwipeEnd: end })))
      expect(responder).toHaveBeenCalledOnce()
      const callbacks = responder.mock.calls[0][0] as Callbacks
      callbacks.onPanResponderRelease(null, { dx: 160, dy: 2 })
      expect(right).toHaveBeenCalledOnce()
      expect(oldRight).not.toHaveBeenCalled()
      expect(end).toHaveBeenCalledWith(true)
    } finally { root.unmount() }
  })

  it('forwards progress and interruption to callbacks added after mounting', () => {
    const root = createRoot(document.createElement('div'))
    const progress = vi.fn()
    const end = vi.fn()
    try {
      flushSync(() => root.render(createElement(Surface)))
      flushSync(() => root.render(createElement(Surface, { onSwipeProgress: progress, onSwipeEnd: end })))
      expect(responder).toHaveBeenCalledOnce()
      const callbacks = responder.mock.calls[0][0] as Callbacks
      callbacks.onPanResponderMove(null, { dx: 38, dy: 1 })
      callbacks.onPanResponderTerminate()
      expect(progress).toHaveBeenCalledWith({ dx: 38, dy: 1 })
      expect(end).toHaveBeenCalledWith(false)
    } finally { root.unmount() }
  })
})
