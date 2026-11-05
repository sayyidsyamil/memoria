import type { MobileWorkspaceWrite } from './mobileWorkspaceEditing'
import { requireWorkspaceWritePath } from './workspaceWriteValidation'

export type WorkspaceTextChange = { path: string; content: string }
export type WorkspaceTextBatchWriter = (root: string, changes: WorkspaceTextChange[]) => void | Promise<void>

/** Preserve the final content when a reducer writes the same note more than once. */
export function workspaceTextBatch(writes: MobileWorkspaceWrite[]): WorkspaceTextChange[] | null {
  if (writes.length < 2) return null
  const changes = new Map<string, string>()
  for (const write of writes) {
    if (write.kind !== 'createNote' && write.kind !== 'saveNote' && write.kind !== 'saveView') return null
    changes.set(requireWorkspaceWritePath(write.path), write.content)
  }
  return [...changes].map(([path, content]) => ({ path, content }))
}
