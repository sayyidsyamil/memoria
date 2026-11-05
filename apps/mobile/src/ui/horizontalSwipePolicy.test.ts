import { describe, expect, it } from 'vitest'

import {
  horizontalSwipeCapturesMovement,
  horizontalSwipeCommitted,
  shouldStartHorizontalSwipe,
} from './horizontalSwipePolicy'

describe('shouldStartHorizontalSwipe', () => {
  it('claims an enabled edge reveal gesture at touch-down', () => {
    expect(shouldStartHorizontalSwipe({ captureOnStart: true, disabled: false })).toBe(true)
  })

  it('does not claim ordinary surface swipes or disabled gestures at touch-down', () => {
    expect(shouldStartHorizontalSwipe({ captureOnStart: false, disabled: false })).toBe(false)
    expect(shouldStartHorizontalSwipe({ captureOnStart: true, disabled: true })).toBe(false)
  })

  it('claims movement only after a horizontal intent threshold', () => {
    expect(horizontalSwipeCapturesMovement({ dx: 13, dy: 4 })).toBe(true)
    expect(horizontalSwipeCapturesMovement({ dx: 11, dy: 0 })).toBe(false)
    expect(horizontalSwipeCapturesMovement({ dx: 20, dy: 18 })).toBe(false)
  })

  it('commits long horizontal movement without excessive vertical drift', () => {
    expect(horizontalSwipeCommitted({ dx: -56, dy: 40 })).toBe(true)
    expect(horizontalSwipeCommitted({ dx: 55, dy: 0 })).toBe(false)
    expect(horizontalSwipeCommitted({ dx: 120, dy: 41 })).toBe(false)
  })
})
