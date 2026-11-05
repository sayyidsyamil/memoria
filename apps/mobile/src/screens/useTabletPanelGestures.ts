import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated'
import { desktopPanelParity } from '../ui/desktopParity'
import { tabletLeftPanelStageAfterDrag, tabletLeftPanelStageOffset, type TabletLeftPanelStage } from './tabletWorkspacePanelTransitions'
import { createTabletPanGesture, tabletPanelSpring, type TabletPanelPosition, type TabletPanSession } from './tabletNativePanGesture'
import { tabletPanelPositionAfterResize } from './tabletPanelResize'
import { tabletLeftChromeMinWidth } from './tabletWorkspaceScreenMode'

export type TabletPanelGestureOptions = {
  compactTablet: boolean
  defaultPropertiesVisible: boolean
  defaultSidebarVisible: boolean
  exclusiveSidePanels: boolean
  propertiesReplaceSidebar: boolean
}

function initialLeftStage(options: TabletPanelGestureOptions): TabletLeftPanelStage {
  if (options.defaultPropertiesVisible && options.propertiesReplaceSidebar) return 'editor'
  return options.compactTablet || !options.defaultSidebarVisible ? 'list' : 'all'
}

export function useTabletPanelGestures(options: TabletPanelGestureOptions) {
  const { width } = useWindowDimensions()
  const { top: topInset } = useSafeAreaInsets()
  const { compactTablet, propertiesReplaceSidebar } = options
  const [position, setPosition] = useState<TabletPanelPosition>(() => ({
    stage: initialLeftStage(options),
    propertiesVisible: options.defaultPropertiesVisible,
  }))
  const left = useSharedValue(tabletLeftPanelStageOffset(initialLeftStage(options), compactTablet))
  const properties = useSharedValue(options.defaultPropertiesVisible ? 0 : desktopPanelParity.inspectorWidth)
  const restoreLeft = useSharedValue(tabletLeftPanelStageOffset(options.defaultSidebarVisible ? 'all' : 'list', compactTablet))
  const session = useSharedValue<TabletPanSession>({ x: 0, y: 0, left: 0, properties: 0, mode: 'wait' })
  const epoch = useSharedValue(0)
  const onSettle = useTabletPanelSettlement(epoch, session, setPosition)
  const motion = useMemo(() => ({ left, properties, restoreLeft }), [left, properties, restoreLeft])
  const panGesture = useMemo(() => createTabletPanGesture({
    compactTablet, propertiesReplaceSidebar, width, topInset, motion, session, epoch, onSettle,
  }), [compactTablet, propertiesReplaceSidebar, width, topInset, motion, session, epoch, onSettle])

  const settle = useCallback((stage: TabletLeftPanelStage, propertiesVisible: boolean) => {
    epoch.set(ticket => ticket + 1)
    session.set({ ...session.get(), mode: 'fail' })
    const normalized = compactTablet && stage === 'all' ? 'list' : stage
    left.set(withSpring(tabletLeftPanelStageOffset(normalized, compactTablet), tabletPanelSpring))
    properties.set(withSpring(propertiesVisible ? 0 : desktopPanelParity.inspectorWidth, tabletPanelSpring))
    setPosition({ stage: normalized, propertiesVisible })
  }, [compactTablet, epoch, left, properties, session])

  useWindowResize(width, () => {
    const next = tabletPanelPositionAfterResize(position, width, compactTablet)
    settle(next.stage, next.propertiesVisible)
  })

  useLayoutEffect(() => {
    left.set(withSpring(tabletLeftPanelStageOffset(position.stage, compactTablet), tabletPanelSpring))
  }, [compactTablet, left, position.stage])

  const showLeftStage = useCallback((stage: TabletLeftPanelStage) => settle(stage, false), [settle])
  const showProperties = useCallback(() => {
    if (!position.propertiesVisible) restoreLeft.set(left.value)
    settle(propertiesReplaceSidebar ? 'editor' : position.stage, true)
  }, [left, position, propertiesReplaceSidebar, restoreLeft, settle])
  const hideProperties = useCallback(() => {
    const stage = propertiesReplaceSidebar
      ? tabletLeftPanelStageAfterDrag({ compactTablet, stage: 'all', startOffset: restoreLeft.value, dx: 0, vx: 0 })
      : position.stage
    settle(tabletPanelPositionAfterResize({ stage, propertiesVisible: false }, width, compactTablet).stage, false)
  }, [compactTablet, position.stage, propertiesReplaceSidebar, restoreLeft, settle, width])
  const showSidebar = position.stage === 'all' && !compactTablet
  const noteListVisible = position.stage !== 'editor'
  const sidebarOverList = sidebarReplacesList(options, width)
  const leftChromeMotion = useLeftChromeMotion(left, compactTablet, sidebarOverList)
  const propertiesMotionStyle = useAnimatedStyle(() => ({
    marginLeft: -properties.value,
    transform: [{ translateX: properties.value }],
  }))

  return {
    hideLeftChrome: useCallback(() => showLeftStage('editor'), [showLeftStage]),
    hideProperties,
    ...leftChromeMotion,
    finishSidebarNavigation: useCallback(() => {
      if (sidebarOverList) showLeftStage('list')
    }, [showLeftStage, sidebarOverList]),
    leftChromeVisible: true,
    noteListVisible,
    panGesture,
    propertiesMotionStyle,
    propertiesPanelVisible: true,
    propertiesVisible: position.propertiesVisible,
    renderNoteList: true,
    renderSidebar: !compactTablet,
    showAllPanels: useCallback(() => settle('all', !propertiesReplaceSidebar), [propertiesReplaceSidebar, settle]),
    showEditorList: useCallback(() => showLeftStage('list'), [showLeftStage]),
    showEditorOnly: useCallback(() => showLeftStage('editor'), [showLeftStage]),
    showLeftChrome: useCallback(() => showLeftStage('all'), [showLeftStage]),
    showProperties,
    showSidebar,
    toggleProperties: useCallback(() => {
      if (position.propertiesVisible) hideProperties()
      else showProperties()
    }, [hideProperties, position.propertiesVisible, showProperties]),
    toggleSidebar: useCallback(() => showLeftStage(showSidebar ? 'list' : 'all'), [showLeftStage, showSidebar]),
    toggleSidebarAndNoteList: useCallback(() => showLeftStage(noteListVisible ? 'editor' : 'all'), [noteListVisible, showLeftStage]),
  }
}

function useTabletPanelSettlement(epoch: SharedValue<number>, session: SharedValue<TabletPanSession>, onSettle: (position: TabletPanelPosition) => void) {
  useLayoutEffect(() => () => {
    epoch.set(ticket => ticket + 1)
    session.set({ ...session.get(), mode: 'fail' })
  }, [epoch, session])
  return useCallback((position: TabletPanelPosition, ticket: number) => {
    if (epoch.get() === ticket) onSettle(position)
  }, [epoch, onSettle])
}

function sidebarReplacesList(options: TabletPanelGestureOptions, width: number) {
  return !options.compactTablet && options.propertiesReplaceSidebar && width < tabletLeftChromeMinWidth
}

function useLeftChromeMotion(left: SharedValue<number>, compact: boolean, sidebarOverList: boolean) {
  const stripWidth = desktopPanelParity.noteListWidth + (compact ? 0 : desktopPanelParity.sidebarWidth)
  const maximumWidth = sidebarOverList ? desktopPanelParity.noteListWidth : stripWidth
  const leftChromeViewportStyle = useAnimatedStyle(() => ({
    width: Math.max(0, Math.min(maximumWidth, stripWidth + left.value)),
  }))
  const leftChromeMotionStyle = useAnimatedStyle(() => {
    const transform = [{ translateX: left.value }]
    return compact ? { marginRight: left.value, transform } : { width: stripWidth, transform }
  })
  return { leftChromeMotionStyle, leftChromeViewportStyle }
}

function useWindowResize(width: number, onResize: () => void) {
  const previousWidth = useRef(width)
  useLayoutEffect(() => {
    if (previousWidth.current === width) return
    previousWidth.current = width
    onResize()
  }, [onResize, width])
}
