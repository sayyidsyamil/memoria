import type { NativeLayoutMetricMap } from './nativeLayoutMetricCore.ts'

/** Project sidebar-only geometry to desktop units; phone and panel widths stay physical. */
export function projectNativeSidebarMetrics(metrics: NativeLayoutMetricMap, density: 1 | 1.2): NativeLayoutMetricMap {
  if (density === 1) return metrics

  return Object.fromEntries(Object.entries(metrics).map(([id, metric]) => [id, id.startsWith('sidebar.') ? {
    ...metric,
    x: metric.x / density,
    y: metric.y / density,
    width: metric.width / density,
    height: metric.height / density,
  } : metric]))
}
