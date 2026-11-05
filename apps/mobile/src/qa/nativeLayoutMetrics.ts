import type {
  NativeLayoutAssertionFailure,
  NativeLayoutMetricMap,
} from './nativeLayoutMetricCore.ts'
import {
  assertSectionTitleLayouts,
  assertSidebarSectionLayouts,
} from './nativeSidebarSectionLayoutMetrics.ts'
import {
  assertCountPillLayouts,
  assertSidebarItemLayouts,
} from './nativeSidebarItemLayoutMetrics.ts'
import {
  assertFolderLayouts,
  assertFolderTreeLayout,
} from './nativeFolderLayoutMetrics.ts'
import {
  assertNativeNoteListLayoutMetrics,
  assertNativePhoneNoteListLayoutMetrics,
} from './nativeNoteListLayoutMetrics.ts'
import {
  assertNativePhoneShellMetrics,
  assertNativePhoneSidebarLayoutMetrics,
  nativePhoneShellMetricContract,
  type NativePhoneLayoutState,
} from './nativePhoneShellLayoutMetrics.ts'
import {
  assertNativePropertiesLayoutMetrics,
  nativePropertiesMetricContract,
} from './nativePropertiesLayoutMetrics.ts'
import { projectNativeSidebarMetrics } from './nativeSidebarLayoutProjection.ts'

export { nativePropertiesMetricContract } from './nativePropertiesLayoutMetrics.ts'
export { type NativeLayoutMetric, type NativeLayoutMetricMap, type NativeLayoutAssertionFailure, parseNativeLayoutMetrics, latestNativeLayoutMetrics, formatNativeLayoutAssertionFailures } from './nativeLayoutMetricCore.ts'
export { nativeSidebarMetricContract } from './nativeSidebarItemLayoutMetrics.ts'
export { nativeNoteListMetricContract } from './nativeNoteListLayoutMetrics.ts'
export { type NativePhoneLayoutState, nativePhoneShellMetricContract } from './nativePhoneShellLayoutMetrics.ts'
export { nativeWysiwygEditorMetricContract, assertNativeWysiwygEditorLayoutMetrics } from './nativeWysiwygLayoutMetrics.ts'

export function assertNativeSidebarLayoutMetrics(
  nativeMetrics: NativeLayoutMetricMap,
  density: 1 | 1.2 = 1,
): NativeLayoutAssertionFailure[] {
  const metrics = projectNativeSidebarMetrics(nativeMetrics, density)
  return [
    ...assertSidebarSectionLayouts(metrics),
    ...assertSidebarItemLayouts(metrics),
    ...assertSectionTitleLayouts(metrics, density !== 1),
    ...assertFolderTreeLayout(metrics),
    ...assertFolderLayouts(metrics),
    ...assertCountPillLayouts(metrics),
  ]
}

export function assertNativeMobileLayoutMetrics(metrics: NativeLayoutMetricMap): NativeLayoutAssertionFailure[] {
  return [
    ...assertNativeSidebarLayoutMetrics(metrics),
    ...assertNativeNoteListLayoutMetrics(metrics),
    ...assertNativePropertiesLayoutMetrics({
      expectedPanelWidth: nativePropertiesMetricContract.panelWidth,
      metrics,
    }),
  ]
}

export function assertNativePhoneLayoutMetrics(
  metrics: NativeLayoutMetricMap,
  state: NativePhoneLayoutState,
): NativeLayoutAssertionFailure[] {
  return [
    ...assertNativePhoneShellMetrics(metrics, state),
    ...assertNativePhoneContentMetrics(metrics, state),
  ]
}

function assertNativePhoneContentMetrics(
  metrics: NativeLayoutMetricMap,
  state: NativePhoneLayoutState,
): NativeLayoutAssertionFailure[] {
  if (state === 'list') return assertNativePhoneNoteListLayoutMetrics(metrics)
  if (state === 'sidebar') {
    return [
      ...assertNativePhoneSidebarLayoutMetrics(metrics),
      ...assertNativeSidebarLayoutMetrics(metrics),
      ...assertNativePhoneNoteListLayoutMetrics(metrics),
    ]
  }
  if (state === 'properties') {
    const root = metrics['phone.root']
    return assertNativePropertiesLayoutMetrics({
      expectedPanelWidth: root?.width ?? nativePhoneShellMetricContract.maxWidth,
      metrics,
    })
  }

  return []
}
