import type { GitLocalAccess } from './gitRemote'
import { runSavedVaultOperation } from './savedVaultOperation'
import type { createWorkspaceSyncEditors } from '../workspaceSyncEditors'

export function createGitEditorAccess(options: {
  editors: ReturnType<typeof createWorkspaceSyncEditors>
  rootUri?: string
  refresh: (selectedNoteId?: string) => void | Promise<void>
  deferWhileFocused?: () => boolean
}): GitLocalAccess {
  return async operation => {
    const wasBlocked = options.editors.isBlocked()
    options.editors.setBlocked(true)
    try {
      let result: Awaited<ReturnType<typeof operation>> | undefined
      await runSavedVaultOperation({
        ...options,
        run: async () => {
          result = await operation()
          return result.workspaceChanged ? undefined : 'unchanged'
        },
      })
      if (!result) throw new Error('syncResultMissing')
      return result.value
    } finally { options.editors.setBlocked(wasBlocked) }
  }
}
