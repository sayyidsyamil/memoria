import { describe, expect, it } from 'vitest'
import { simulatorWindowTargetPoint } from './nativeSimulatorWindowGeometry'

describe('native Simulator window geometry', () => {
  it('maps a logical React Native element into the visible Simulator display surface', () => {
    const point = simulatorWindowTargetPoint({
      logicalScreen: { height: 1032, width: 1376, x: 0, y: 0 },
      simulatorSurface: { height: 932, width: 1242, x: 1261, y: 129 },
      target: { height: 24, width: 24, x: 559.5, y: 38 },
    })

    expect(point.x).toBeCloseTo(1776.85, 2)
    expect(point.y).toBeCloseTo(174.16, 2)
  })

  it('rejects targets outside the logical screen instead of clicking unrelated chrome', () => {
    expect(() => simulatorWindowTargetPoint({
      logicalScreen: { height: 1032, width: 1376, x: 0, y: 0 },
      simulatorSurface: { height: 932, width: 1242, x: 1261, y: 129 },
      target: { height: 24, width: 24, x: 1370, y: 38 },
    })).toThrow('outside the logical Simulator screen')
  })
})
