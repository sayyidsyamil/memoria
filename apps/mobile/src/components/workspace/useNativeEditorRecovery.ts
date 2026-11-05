import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { useMobileAnalytics } from '../../analytics/useMobileAnalytics'
import { WorkspaceSyncEditorsContext } from '../../workspace/workspaceSyncEditors'
import { createNativeEditorRecovery, type NativeEditorLossReason } from './nativeEditorRecovery'

export type NativeEditorRecoveryHandlers = { onProcessLoss: (reason: NativeEditorLossReason) => void }

export function useNativeEditorRecovery() {
  const editors = useContext(WorkspaceSyncEditorsContext)
  const analytics = useMobileAnalytics()
  const [generation, setGeneration] = useState(0)
  const current = useRef(0)
  const requestedAt = useRef(0)
  const recovery = useRef<ReturnType<typeof createNativeEditorRecovery> | null>(null)
  useEffect(() => {
    const controller = createNativeEditorRecovery({
      active: AppState.currentState === 'active',
      generation: current.current,
      isBlocked: () => editors?.isBlocked() === true,
      restart: (next, reason) => {
        current.current = next
        setGeneration(next)
        analytics.capture({ name: 'mobile_editor_recovery_requested', reason })
        console.info('[mobile-editor] Restarting terminated editor session', {
          reason, queuedMs: Math.round(performance.now() - requestedAt.current),
        })
      },
    })
    recovery.current = controller
    const subscription = AppState.addEventListener('change', state => controller.setActive(state === 'active'))
    return () => { subscription.remove(); controller.dispose(); recovery.current = null }
  }, [analytics, editors])
  const onProcessLoss = useCallback((reason: NativeEditorLossReason) => {
    requestedAt.current = performance.now()
    recovery.current?.lost(generation, reason)
  }, [generation])
  return { generation, onProcessLoss }
}
