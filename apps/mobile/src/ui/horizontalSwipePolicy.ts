type HorizontalSwipeStartPolicy = {
  captureOnStart: boolean
  disabled: boolean
}

export type HorizontalSwipeOffset = {
  dx: number
  dy: number
}

const minimumCommitDistance = 56
const minimumCaptureDistance = 12
const maximumVerticalDrift = 40

export function shouldStartHorizontalSwipe({
  captureOnStart,
  disabled,
}: HorizontalSwipeStartPolicy) {
  return captureOnStart && !disabled
}

export function horizontalSwipeCapturesMovement({ dx, dy }: HorizontalSwipeOffset) {
  return Math.abs(dx) > minimumCaptureDistance && Math.abs(dx) > Math.abs(dy) * 1.4
}

export function horizontalSwipeCommitted({ dx, dy }: HorizontalSwipeOffset) {
  return Math.abs(dx) >= minimumCommitDistance && Math.abs(dy) <= maximumVerticalDrift
}
