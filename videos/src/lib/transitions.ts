/**
 * FLIP (First, Last, Invert, Play) and shared-element transition helpers
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Transform {
  x: number;
  y: number;
  scale: number;
  rotate: number;
  opacity: number;
}

/**
 * Calculate transform from source rect to target rect
 */
export function calculateTransform(
  source: Rect,
  target: Rect,
  progress: number,
  easingFn: (t: number) => number = (t) => t
): Transform {
  const t = easingFn(progress);

  const scaleX = source.width / target.width;
  const scaleY = source.height / target.height;
  const scale = Math.min(scaleX, scaleY);

  const sourceCenterX = source.x + source.width / 2;
  const sourceCenterY = source.y + source.height / 2;
  const targetCenterX = target.x + target.width / 2;
  const targetCenterY = target.y + target.height / 2;

  const x = sourceCenterX + (targetCenterX - sourceCenterX) * t;
  const y = sourceCenterY + (targetCenterY - sourceCenterY) * t;

  return {
    x,
    y,
    scale: scale + (1 - scale) * t,
    rotate: 0,
    opacity: 1,
  };
}

/**
 * Create a burst-out transform (items exploding from a center point)
 */
export function burstOutTransform(
  startCenter: Point,
  endPosition: Rect,
  progress: number,
  rotation: number = 0,
  easingFn: (t: number) => number = (t) => t
): Transform {
  const t = easingFn(progress);

  const endCenterX = endPosition.x + endPosition.width / 2;
  const endCenterY = endPosition.y + endPosition.height / 2;

  const x = startCenter.x + (endCenterX - startCenter.x) * t;
  const y = startCenter.y + (endCenterY - startCenter.y) * t;

  return {
    x,
    y,
    scale: 0.3 + 0.7 * t,
    rotate: rotation * (1 - t),
    opacity: Math.min(t * 2, 1),
  };
}

/**
 * Apply transform to CSS
 */
export function transformToCSS(transform: Transform): React.CSSProperties {
  return {
    transform: `translate(-50%, -50%) translate(${transform.x}px, ${transform.y}px) scale(${transform.scale}) rotate(${transform.rotate}deg)`,
    opacity: transform.opacity,
  };
}
