import { describe, expect, it } from 'vitest'
import type { NativeLayoutMetricMap } from './nativeLayoutMetrics'
import { assertNativePropertiesLayoutMetrics, nativePropertiesMetricContract } from './nativePropertiesLayoutMetrics'

const panelWidth = nativePropertiesMetricContract.panelWidth
const panelPadding = nativePropertiesMetricContract.panelPadding
const rowWidth = panelWidth - panelPadding * 2

describe('native properties layout bounds', () => {
  it('rejects single property rows that stretch to the inspector viewport height', () => {
    const metrics = propertyMetrics('properties.row.url', 1_221)

    const failures = assertNativePropertiesLayoutMetrics({
      expectedPanelWidth: panelWidth,
      metrics,
    })

    expect(failures).toContainEqual(
      expect.objectContaining({
        actual: 1_221,
        expected: nativePropertiesMetricContract.rowMaxHeight,
        id: 'properties.row.url',
      }),
    )
  })
})

function propertyMetrics(id: string, height: number): NativeLayoutMetricMap {
  return {
    'properties.panel': metric({
      height: 1_297,
      id: 'properties.panel',
      width: panelWidth,
    }),
    [`${id}.row`]: metric({
      height,
      id: `${id}.row`,
      width: rowWidth,
      x: panelPadding,
    }),
    [`${id}.label`]: metric({
      height: 14.5,
      id: `${id}.label`,
      width: nativePropertiesMetricContract.labelWidth,
      x: nativePropertiesMetricContract.rowPaddingHorizontal,
    }),
    [`${id}.value`]: metric({
      height: 14.5,
      id: `${id}.value`,
      width: 172,
      x: 97.5,
    }),
  }
}

function metric({
  height,
  id,
  width,
  x = 0,
  y = 0,
}: {
  height: number
  id: string
  width: number
  x?: number
  y?: number
}) {
  return { height, id, platform: 'ios', width, x, y }
}
