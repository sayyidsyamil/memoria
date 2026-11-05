import {
  expectAtLeast,
  expectAtMost,
  expectClose,
  expectMetric,
  type NativeLayoutAssertionFailure,
  type NativeLayoutMetric,
  type NativeLayoutMetricMap,
} from './nativeLayoutMetricCore.ts'
import {
  phoneWorkspaceSidebarDrawerMaxWidth,
  phoneWorkspaceSidebarDrawerWidth,
  phoneWorkspaceSidebarDrawerWidthRatio,
} from '../screens/phoneWorkspaceTransitions.ts'

export type NativePhoneLayoutState = 'editor' | 'list' | 'properties' | 'sidebar'

type PhoneShellMetrics = {
  root: NativeLayoutMetric | undefined
  screen: NativeLayoutMetric | undefined
}

export const nativePhoneShellMetricContract = {
  drawerMaxWidth: phoneWorkspaceSidebarDrawerMaxWidth,
  drawerWidthRatio: phoneWorkspaceSidebarDrawerWidthRatio,
  maxWidth: 899,
  minContentHeight: 320,
  minRootHeight: 480,
} as const

export function assertNativePhoneShellMetrics(
  metrics: NativeLayoutMetricMap,
  state: NativePhoneLayoutState,
): NativeLayoutAssertionFailure[] {
  const shell = phoneShellMetrics(metrics, state)

  return [
    ...expectMetric({
      id: 'phone.root',
      message: 'phone root is captured before checking native phone layout',
      metric: shell.root,
    }),
    ...expectMetric({
      id: `phone.${state}.screen`,
      message: 'active phone screen is captured before checking native phone layout',
      metric: shell.screen,
    }),
    ...assertPhoneRootDimensions(shell.root),
    ...assertPhoneScreenDimensions(shell, state),
  ]
}

function assertPhoneRootDimensions(root: NativeLayoutMetric | undefined): NativeLayoutAssertionFailure[] {
  return [
    ...expectAtLeast({
      actual: root?.height ?? null,
      expected: nativePhoneShellMetricContract.minRootHeight,
      id: 'phone.root',
      message: 'phone root keeps enough vertical space for native workspace chrome',
    }),
    ...expectAtMost({
      actual: root?.width ?? null,
      expected: nativePhoneShellMetricContract.maxWidth,
      id: 'phone.root',
      message: 'phone layout metric is captured on the compact phone breakpoint',
    }),
  ]
}

function assertPhoneScreenDimensions(
  shell: PhoneShellMetrics,
  state: NativePhoneLayoutState,
): NativeLayoutAssertionFailure[] {
  return [
    ...expectClose({
      actual: shell.root && shell.screen ? shell.screen.width - shell.root.width : null,
      expected: 0,
      id: `phone.${state}.screen`,
      message: 'active phone screen spans the phone root width',
    }),
    ...expectAtLeast({
      actual: shell.screen?.height ?? null,
      expected: nativePhoneShellMetricContract.minContentHeight,
      id: `phone.${state}.screen`,
      message: 'active phone screen keeps usable content height',
    }),
  ]
}

function phoneShellMetrics(metrics: NativeLayoutMetricMap, state: NativePhoneLayoutState): PhoneShellMetrics {
  return {
    root: metrics['phone.root'],
    screen: metrics[`phone.${state}.screen`],
  }
}

export function assertNativePhoneSidebarLayoutMetrics(metrics: NativeLayoutMetricMap): NativeLayoutAssertionFailure[] {
  const root = metrics['phone.root']
  const drawer = metrics['phone.sidebar.drawer']
  const preview = metrics['phone.sidebar.preview']
  const expectedDrawerWidth = root ? phoneSidebarDrawerWidth(root.width) : nativePhoneShellMetricContract.drawerMaxWidth

  return [
    ...expectMetric({
      id: 'phone.sidebar.drawer',
      message: 'phone sidebar drawer is captured before checking native drawer layout',
      metric: drawer,
    }),
    ...expectMetric({
      id: 'phone.sidebar.preview',
      message: 'phone sidebar preview is captured before checking native drawer layout',
      metric: preview,
    }),
    ...assertPhoneDrawerFrame(drawer, expectedDrawerWidth),
    ...assertPhonePreviewFrame({ expectedDrawerWidth, preview, root }),
  ]
}

function assertPhoneDrawerFrame(
  drawer: NativeLayoutMetric | undefined,
  expectedDrawerWidth: number,
): NativeLayoutAssertionFailure[] {
  return [
    ...expectClose({
      actual: drawer?.x ?? null,
      expected: 0,
      id: 'phone.sidebar.drawer',
      message: 'phone sidebar drawer starts at the root leading edge',
    }),
    ...expectClose({
      actual: drawer?.width ?? null,
      expected: expectedDrawerWidth,
      id: 'phone.sidebar.drawer',
      message: 'phone sidebar drawer keeps the compact navigation width',
    }),
  ]
}

function assertPhonePreviewFrame({
  expectedDrawerWidth,
  preview,
  root,
}: {
  expectedDrawerWidth: number
  preview: NativeLayoutMetric | undefined
  root: NativeLayoutMetric | undefined
}): NativeLayoutAssertionFailure[] {
  return [
    ...expectClose({
      actual: preview?.x ?? null,
      expected: expectedDrawerWidth,
      id: 'phone.sidebar.preview',
      message: 'phone sidebar keeps the note-list preview attached to the drawer edge',
    }),
    ...expectClose({
      actual: preview && root ? preview.width - root.width : null,
      expected: 0,
      id: 'phone.sidebar.preview',
      message: 'phone sidebar preview preserves the full note-list surface width',
    }),
  ]
}

function phoneSidebarDrawerWidth(rootWidth: number) {
  return phoneWorkspaceSidebarDrawerWidth(rootWidth)
}
