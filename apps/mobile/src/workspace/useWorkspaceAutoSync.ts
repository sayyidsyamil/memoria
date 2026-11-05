import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { addNetworkStateListener } from 'expo-network'
import { createMobileAutoGit } from './git/mobileAutoGit'
import { createWorkspaceSyncLifecycle } from './workspaceSyncLifecycle'
import type { createWorkspaceSyncEditors } from './workspaceSyncEditors'

export type WorkspaceAutoSyncOptions = {
  blocked: boolean
  editors: ReturnType<typeof createWorkspaceSyncEditors>
  enabled: boolean
  rootUri?: string
  sync: (signal?: AbortSignal) => Promise<unknown>
}

export function useWorkspaceAutoSync(options: WorkspaceAutoSyncOptions, idleMs: number, pollMs: number) {
  const { editors, rootUri, blocked, enabled } = options
  const latest = useRef(options)
  const lifecycle = useRef<ReturnType<typeof createWorkspaceSyncLifecycle> | null>(null)
  useEffect(() => { latest.current = options }, [options])
  useEffect(() => {
    if (!rootUri) return
    const scheduler = createMobileAutoGit(signal => latest.current.sync(signal), idleMs)
    const events = createWorkspaceSyncLifecycle(scheduler, () => latest.current, AppState.currentState)
    lifecycle.current = events
    const dirty = editors.subscribeDirty(scheduler.dirty)
    const subscription = AppState.addEventListener('change', events.change)
    let connected = true
    const network = addNetworkStateListener(state => {
      if (state.isConnected === undefined) return
      const available = state.isConnected && state.isInternetReachable !== false
      if (available && !connected) scheduler.reconnect()
      connected = available
    })
    const timer = setInterval(events.poll, pollMs)
    events.poll()
    return () => {
      dirty(); subscription.remove(); network.remove(); clearInterval(timer)
      scheduler.dispose(); lifecycle.current = null
    }
  }, [editors, rootUri, idleMs, pollMs])
  useEffect(() => { lifecycle.current?.refresh() }, [enabled, blocked])
}
