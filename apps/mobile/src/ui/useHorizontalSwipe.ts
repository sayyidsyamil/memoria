import { useLayoutEffect, useState } from 'react'
import { PanResponder, type PanResponderGestureState } from 'react-native'

import {
  horizontalSwipeCapturesMovement,
  horizontalSwipeCommitted,
  shouldStartHorizontalSwipe,
  type HorizontalSwipeOffset,
} from './horizontalSwipePolicy'

type HorizontalSwipeProgress = {
  dx: number
  dy: number
}

type HorizontalSwipeOptions = {
  direction?: 'left' | 'right'
  canStart?: (start: { x: number; y: number }) => boolean
  captureOnStart?: boolean
  disabled?: boolean
  onSwipeEnd?: (committed: boolean) => void
  onSwipeLeft?: () => void
  onSwipeProgress?: (progress: HorizontalSwipeProgress) => void
  onSwipeRight?: () => void
}

type NormalizedHorizontalSwipeOptions = HorizontalSwipeOptions & {
  captureOnStart: boolean
  disabled: boolean
}

export function useHorizontalSwipe(input: HorizontalSwipeOptions) {
  const options = { ...input, captureOnStart: input.captureOnStart ?? false, disabled: input.disabled ?? false }
  // Preview updates must not replace PanResponder's in-flight gesture state.
  const [responder] = useState(() => createHorizontalSwipeResponder(options))
  useLayoutEffect(() => { responder.update(options) })
  return responder.panHandlers
}

function createHorizontalSwipeResponder(initial: NormalizedHorizontalSwipeOptions) {
  let options = initial
  return {
    panHandlers: createHorizontalSwipeHandlers(() => options),
    update: (next: NormalizedHorizontalSwipeOptions) => { options = next },
  }
}

function createHorizontalSwipeHandlers(options: () => NormalizedHorizontalSwipeOptions) {
  let touchStart: { x: number; y: number } | undefined
  return PanResponder.create({
    onStartShouldSetPanResponderCapture: (event) => {
      touchStart = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }
      return false
    },
    onStartShouldSetPanResponder: () => shouldStartHorizontalSwipe(options()),
    onMoveShouldSetPanResponder: (_, gesture) => shouldCapture(gesture, options(), touchStart),
    onMoveShouldSetPanResponderCapture: (_, gesture) => shouldCapture(gesture, options(), touchStart),
    onPanResponderRelease: (_, gesture) => releaseHorizontalSwipe(gesture, options()),
    onPanResponderTerminationRequest: () => true,
    onPanResponderMove: (_, gesture) => options().onSwipeProgress?.({ dx: gesture.dx, dy: gesture.dy }),
    onPanResponderTerminate: () => options().onSwipeEnd?.(false),
  }).panHandlers
}

function releaseHorizontalSwipe(
  gesture: HorizontalSwipeOffset,
  options: NormalizedHorizontalSwipeOptions,
  allowCommit = true,
) {
  const committed = allowCommit && horizontalSwipeCommitted(gesture)
  if (committed) commitHorizontalSwipe(gesture, options)
  options.onSwipeEnd?.(committed)
}

function commitHorizontalSwipe(
  gesture: HorizontalSwipeOffset,
  options: Pick<HorizontalSwipeOptions, 'onSwipeLeft' | 'onSwipeRight'>,
) {
  const action = gesture.dx < 0 ? options.onSwipeLeft : options.onSwipeRight
  action?.()
}

function shouldCapture(gesture: PanResponderGestureState, options: NormalizedHorizontalSwipeOptions, start: { x: number; y: number } | undefined) {
  if (options.disabled || gesture.numberActiveTouches !== 1) return false
  if (!matchesSwipeDirection(gesture.dx, options.direction)) return false
  // Movement samples can begin after touch-down; x0/y0 are unset before grant.
  if (!start) return false
  if (options.canStart?.(start) === false) return false
  return horizontalSwipeCapturesMovement(gesture)
}

function matchesSwipeDirection(dx: number, direction: HorizontalSwipeOptions['direction']) {
  return !direction || direction === (dx < 0 ? 'left' : 'right')
}
