import type { MobileWorkspaceSnapshot } from '../workspace/mobileWorkspaceModel'
import { emptyMobileWorkspaceHistory, type MobileWorkspaceHistoryState } from './tabletWorkspaceHistory'
import { createWorkspaceReloadCompletion } from '../workspace/workspaceReloadReconciliation'

type Update<Value> = Value | ((previous: Value) => Value)

/** A replaced frame keeps its own late completions, never the new workspace's state. */
export function createWorkspaceSnapshotFrame(snapshot: MobileWorkspaceSnapshot, generation?: number) {
  let state = { workspaceSnapshot: snapshot, workspaceHistory: emptyMobileWorkspaceHistory }
  const listeners = new Set<() => void>()
  const workspaceSnapshotRef = { current: snapshot }
  let reloading: AbortController | undefined
  const emit = () => { for (const listener of listeners) listener() }
  const setWorkspaceSnapshot = (update: Update<MobileWorkspaceSnapshot>) => {
    const next = updatedValue(state.workspaceSnapshot, update)
    if (next === state.workspaceSnapshot) return
    workspaceSnapshotRef.current = next
    state = { ...state, workspaceSnapshot: next }
    emit()
  }
  const setWorkspaceHistory = (update: Update<MobileWorkspaceHistoryState>) => {
    const next = updatedValue(state.workspaceHistory, update)
    if (next === state.workspaceHistory) return
    state = { ...state, workspaceHistory: next }
    emit()
  }
  return {
    beginBackgroundReload: () => {
      reloading?.abort()
      reloading = new AbortController()
      return createWorkspaceReloadCompletion({ baseline: state.workspaceSnapshot,
        current: () => state.workspaceSnapshot, publish: setWorkspaceSnapshot, controller: reloading })
    },
    generation,
    workspaceSnapshotRef,
    replaceWorkspaceSnapshot: setWorkspaceSnapshot,
    setWorkspaceSnapshot,
    setWorkspaceHistory,
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

function updatedValue<Value>(previous: Value, update: Update<Value>): Value {
  return typeof update === 'function' ? (update as (value: Value) => Value)(previous) : update
}
