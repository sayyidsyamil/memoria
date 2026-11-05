import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { Platform } from 'react-native'
import { cancelAnimation, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated'
import { createPhonePanGesture, type PhonePanSession, type PhonePanTrace } from './phoneNativePanGesture'
import { phoneRailBounds, phoneRailOffset, type PhoneRailGeometry } from './phonePanelRail'
import { phoneWorkspaceTransitionDurationMs, type PhoneWorkspaceState } from './phoneWorkspaceTransitions'
import { postNativeQaEvent } from '../qa/nativeQaSink'

export function usePhonePanelRail(state: PhoneWorkspaceState, width: number, onSettle: (state: PhoneWorkspaceState) => void, diagnostics = false) {
  const reduceMotion = useReducedMotion()
  const previousWidth = useRef(width)
  const initialOffset = phoneRailOffset(state, width)
  const offset = useSharedValue(initialOffset)
  const epoch = useSharedValue(0)
  const geometry = useSharedValue<PhoneRailGeometry>({ width, reduceMotion })
  const session = useSharedValue<PhonePanSession>({ x: 0, y: 0, base: initialOffset, translation: 0,
    mode: 'fail', bounds: phoneRailBounds(initialOffset, width) })
  const acceptSettle = usePhoneRailSettlement(epoch, offset, onSettle, diagnostics)
  const onTrace = diagnostics ? emitPhonePanTrace : undefined
  const gesture = useMemo(() => createPhonePanGesture({ geometry, offset, epoch, session, onSettle: acceptSettle, onTrace }),
    [acceptSettle, epoch, geometry, offset, session, onTrace])

  useLayoutEffect(() => {
    const resized = previousWidth.current !== width
    previousWidth.current = width
    geometry.set({ width, reduceMotion })
    const target = phoneRailOffset(state, width)
    if (diagnostics) postNativeQaEvent({ kind: 'phone-pan-state', state, width, target, offset: offset.get(), epoch: epoch.get(), at: Date.now() })
    if (!resized && Math.abs(offset.get() - target) < 0.5) return
    epoch.set(current => current + 1)
    session.set({ ...session.get(), mode: 'fail' })
    cancelAnimation(offset)
    offset.set(resized ? target : withTiming(target, { duration: reduceMotion ? 0 : phoneWorkspaceTransitionDurationMs }))
  }, [diagnostics, epoch, geometry, offset, reduceMotion, session, state, width])

  useLayoutEffect(() => () => {
    epoch.set(current => current + 1)
    session.set({ ...session.get(), mode: 'fail' })
    cancelAnimation(offset)
  }, [epoch, offset, session])

  return { enabled: Platform.OS !== 'web', gesture, offset }
}

function usePhoneRailSettlement(epoch: SharedValue<number>, offset: SharedValue<number>, onSettle: (state: PhoneWorkspaceState) => void, diagnostics: boolean) {
  return useCallback((next: PhoneWorkspaceState, ticket: number) => {
    if (diagnostics) postNativeQaEvent({ kind: 'phone-pan-commit', next, ticket, epoch: epoch.get(), offset: offset.get(), at: Date.now() })
    if (epoch.get() === ticket) onSettle(next)
  }, [diagnostics, epoch, offset, onSettle])
}

function emitPhonePanTrace(event: PhonePanTrace) {
  postNativeQaEvent({ kind: 'phone-pan', ...event })
}
