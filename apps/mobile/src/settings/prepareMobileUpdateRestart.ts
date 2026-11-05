import type { createWorkspaceSyncEditors } from '../workspace/workspaceSyncEditors'
import { withSavedWorkspace } from '../workspace/git/workspaceWriteQueue'

export async function prepareMobileUpdateRestart({ editors, rootUri, busy }: {
  editors: ReturnType<typeof createWorkspaceSyncEditors>; rootUri?: string; busy: boolean
}) {
  if (busy) throw new Error('vaultOperationInProgress')
  const wasBlocked = editors.isBlocked()
  editors.setBlocked(true)
  let resume = () => {}
  const release = () => { resume(); editors.setBlocked(wasBlocked) }
  try {
    resume = await editors.prepare()
    if (rootUri) await withSavedWorkspace(rootUri, async () => {})
    return release
  } catch (error) { release(); throw error }
}
