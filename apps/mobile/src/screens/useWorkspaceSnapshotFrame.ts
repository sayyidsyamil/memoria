import { useContext, useState, useSyncExternalStore } from 'react'
import { WorkspaceSnapshotRevisionContext, WorkspaceSyncEditorsContext } from '../workspace/workspaceSyncEditors'
import type { MobileWorkspaceSnapshot } from '../workspace/mobileWorkspaceModel'
import { createWorkspaceSnapshotFrame } from './workspaceSnapshotFrame'
import type { createWorkspaceSyncEditors } from '../workspace/workspaceSyncEditors'

type FrameIdentity = { revision: number; root?: string | null; editors: ReturnType<typeof createWorkspaceSyncEditors> | null }

/** Revision publication follows the existing save/recovery/preparation barrier. */
export function useWorkspaceSnapshotFrame(snapshot: MobileWorkspaceSnapshot, root?: string | null) {
  const revision = useContext(WorkspaceSnapshotRevisionContext)
  const editors = useContext(WorkspaceSyncEditorsContext)
  const identity = { revision, root, editors }
  const [current, setCurrent] = useState(() => ({ identity,
    frame: createWorkspaceSnapshotFrame(snapshot, editors?.generation()) }))
  if (!sameFrameIdentity(current.identity, identity)) {
    setCurrent({ identity, frame: createWorkspaceSnapshotFrame(snapshot, editors?.generation()) })
  }
  const { frame } = current
  const state = useSyncExternalStore(frame.subscribe, frame.getSnapshot, frame.getSnapshot)
  return { ...frame, ...state }
}

function sameFrameIdentity(previous: FrameIdentity, next: FrameIdentity) {
  if (previous.revision !== next.revision) return false
  if (previous.root !== next.root) return false
  return previous.editors === next.editors
}
