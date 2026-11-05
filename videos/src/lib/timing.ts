/**
 * Timing and easing utilities for motion graphics
 */

/**
 * Strong ease-out curve (exponential-out style)
 * Similar to cubic-bezier(0.16, 1, 0.3, 1)
 */
export function easeOut(t: number): number {
  return 1 - (1 - t) ** 4;
}

/**
 * Ease-in-out curve
 */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * Ease-in curve
 */
export function easeIn(t: number): number {
  return t * t * t;
}

/**
 * Spring-like ease-out with slight overshoot
 */
export function spring(t: number): number {
  return 1 + Math.sin((t - 1) * Math.PI * 1.5) * 0.1;
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Linear interpolation
 */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

/**
 * Map a value from one range to another with easing
 */
export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
  easingFn: (t: number) => number = (t) => t
): number {
  const t = clamp((value - inMin) / (inMax - inMin), 0, 1);
  return lerp(outMin, outMax, easingFn(t));
}

/**
 * Stagger delay calculator for cascading animations
 * @param index - Item index
 * @param totalDelay - Total time to stagger across all items
 * @param itemCount - Total number of items
 */
export function staggerDelay(
  index: number,
  totalDelay: number,
  itemCount: number
): number {
  return (index / Math.max(itemCount - 1, 1)) * totalDelay;
}
